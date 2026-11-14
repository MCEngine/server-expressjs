import type { Kysely } from 'kysely';
import type { Database } from '../../../db/schema.js';
import { ensureAccountIn, type AccountKey } from './repository.js';

/** Which paged store a request reads: the player inventory pages or the ender chest pages. */
export type PageKind = 'inventory' | 'enderchest';

/**
 * Extra key columns in front of the account key. MCMultiverse has none;
 * MCRealm adds `realm_id`, so the same account holds separate pages per realm.
 */
export type PageScope = Readonly<Record<string, string>>;

export interface Page {
  page_number: number;
  contents: string;
  updated_at: string;
}

export interface Equipment {
  contents: string;
  updated_at: string;
}

/** Everything a game server saves for one account when the player leaves. */
export interface Snapshot {
  inventory: { page_number: number; contents: string }[];
  equipment: string | null;
  enderchest: { page_number: number; contents: string }[];
  /** Releases the session lock this server holds, in the same transaction. */
  release_server_id: string | null;
}

/** The inventory, ender chest and equipment tables one plugin stores pages in. */
export interface PageTables {
  inventory: keyof Database;
  enderchest: keyof Database;
  equipment: keyof Database;
}

export interface PageStore {
  page(kind: PageKind, scope: PageScope, key: AccountKey, pageNumber: number): Promise<Page | undefined>;
  pages(kind: PageKind, scope: PageScope, key: AccountKey): Promise<Page[]>;
  putPage(kind: PageKind, scope: PageScope, key: AccountKey, pageNumber: number, contents: string, at: string): Promise<Page>;
  equipment(scope: PageScope, key: AccountKey): Promise<Equipment | undefined>;
  putEquipment(scope: PageScope, key: AccountKey, contents: string, at: string): Promise<Equipment>;
  /** Writes a whole snapshot in one transaction. */
  saveSnapshot(scope: PageScope, key: AccountKey, snapshot: Snapshot, at: string): Promise<void>;
}

/**
 * Pages kept by the account key plus a scope. The table names come from the
 * plugin, so this works on an untyped view of the database; every value is
 * still bound as a parameter.
 */
export function createPageStore(typed: Kysely<Database>, tables: PageTables): PageStore {
  // Untyped: the table is chosen at runtime from `tables`.
  const db = typed as unknown as Kysely<any>;

  const where = <Q extends { where: (...args: any[]) => Q }>(query: Q, scope: PageScope, key: AccountKey): Q => {
    let q = query;
    for (const [column, value] of Object.entries(scope)) q = q.where(column, '=', value);
    return q.where('account_type', '=', key.accountType).where('account_uuid', '=', key.accountUuid);
  };

  async function upsertPage(trx: Kysely<any>, table: string, scope: PageScope, key: AccountKey, pageNumber: number, contents: string, at: string) {
    const held = await where(trx.selectFrom(table).select('page_number'), scope, key)
      .where('page_number', '=', pageNumber)
      .executeTakeFirst();
    if (held === undefined) {
      await trx
        .insertInto(table)
        .values({ ...scope, account_type: key.accountType, account_uuid: key.accountUuid, page_number: pageNumber, contents, created_at: at, updated_at: at })
        .execute();
    } else {
      await where(trx.updateTable(table).set({ contents, updated_at: at }), scope, key)
        .where('page_number', '=', pageNumber)
        .execute();
    }
  }

  async function upsertEquipment(trx: Kysely<any>, scope: PageScope, key: AccountKey, contents: string, at: string) {
    const held = await where(trx.selectFrom(tables.equipment).select('contents'), scope, key).executeTakeFirst();
    if (held === undefined) {
      await trx
        .insertInto(tables.equipment)
        .values({ ...scope, account_type: key.accountType, account_uuid: key.accountUuid, contents, created_at: at, updated_at: at })
        .execute();
    } else {
      await where(trx.updateTable(tables.equipment).set({ contents, updated_at: at }), scope, key).execute();
    }
  }

  return {
    page: (kind, scope, key, pageNumber) =>
      where(db.selectFrom(tables[kind]).select(['page_number', 'contents', 'updated_at']), scope, key)
        .where('page_number', '=', pageNumber)
        .executeTakeFirst(),

    pages: (kind, scope, key) =>
      where(db.selectFrom(tables[kind]).select(['page_number', 'contents', 'updated_at']), scope, key)
        .orderBy('page_number')
        .execute(),

    putPage: (kind, scope, key, pageNumber, contents, at) =>
      db.transaction().execute(async (trx) => {
        await ensureAccountIn(trx, key, at);
        await upsertPage(trx, tables[kind], scope, key, pageNumber, contents, at);
        return { page_number: pageNumber, contents, updated_at: at };
      }),

    equipment: (scope, key) =>
      where(db.selectFrom(tables.equipment).select(['contents', 'updated_at']), scope, key).executeTakeFirst(),

    putEquipment: (scope, key, contents, at) =>
      db.transaction().execute(async (trx) => {
        await ensureAccountIn(trx, key, at);
        await upsertEquipment(trx, scope, key, contents, at);
        return { contents, updated_at: at };
      }),

    saveSnapshot: (scope, key, snapshot, at) =>
      db.transaction().execute(async (trx) => {
        await ensureAccountIn(trx, key, at);
        for (const page of snapshot.inventory) await upsertPage(trx, tables.inventory, scope, key, page.page_number, page.contents, at);
        for (const page of snapshot.enderchest) await upsertPage(trx, tables.enderchest, scope, key, page.page_number, page.contents, at);
        if (snapshot.equipment !== null) await upsertEquipment(trx, scope, key, snapshot.equipment, at);
        if (snapshot.release_server_id !== null) {
          await trx
            .deleteFrom('universe_account_session')
            .where('account_type', '=', key.accountType)
            .where('account_uuid', '=', key.accountUuid)
            .where('server_id', '=', snapshot.release_server_id)
            .execute();
        }
      }),
  };
}
