import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../db/schema.js';
import { ensureAccountIn } from '../universe/index.js';

export interface RealmType {
  id: number;
  system_code: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

/** A realm with its property row and its type's system code. The owner is null unless it is personal. */
export interface Realm {
  id: string;
  realm_type: string;
  realm_name: string;
  display_name: string;
  account_type: string | null;
  account_uuid: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewRealm {
  id: string;
  realm_type: string;
  realm_name: string;
  display_name: string;
  account_type: string | null;
  account_uuid: string | null;
}

export interface RealmEdit {
  realm_name?: string | undefined;
  display_name?: string | undefined;
}

/** Why a realm write was refused. */
export type RealmRefusal = 'type_not_found' | 'name_taken' | 'id_taken' | 'not_found' | 'has_worlds' | 'world_not_found';

export type RealmResult<T> = { ok: true; value: T } | { ok: false; reason: RealmRefusal };

export interface CentralRealmRepository {
  realmTypes(): Promise<RealmType[]>;
  /** Creates a realm type or renames its display name. */
  putRealmType(systemCode: string, displayName: string, at: string): Promise<RealmType>;
  realms(): Promise<Realm[]>;
  realm(id: string): Promise<Realm | undefined>;
  createRealm(realm: NewRealm, at: string): Promise<RealmResult<Realm>>;
  editRealm(id: string, edit: RealmEdit, at: string): Promise<RealmResult<Realm>>;
  /** Deletes a realm that no longer holds a world, and every page stored in it. */
  deleteRealm(id: string): Promise<RealmResult<true>>;
  /** Puts a world in a realm, moving it out of any other. */
  assignWorld(realmId: string, worldId: string, at: string): Promise<RealmResult<true>>;
  unassignWorld(realmId: string, worldId: string): Promise<boolean>;
  realmOfWorld(worldId: string): Promise<Realm | undefined>;
}

type Db = Kysely<Database> | Transaction<Database>;

function realmQuery(db: Db) {
  return db
    .selectFrom('mcrealm_realms as r')
    .innerJoin('mcrealm_realm_property as p', 'p.realm_id', 'r.id')
    .innerJoin('mcrealm_realm_types as t', 't.id', 'r.realm_type_id')
    .select([
      'r.id',
      't.system_code as realm_type',
      'p.realm_name',
      'p.display_name',
      'r.account_type',
      'r.account_uuid',
      'r.created_at',
      'p.updated_at',
    ]);
}

async function nameTaken(trx: Db, name: string, except: string): Promise<boolean> {
  const held = await trx
    .selectFrom('mcrealm_realm_property')
    .select('realm_id')
    .where('realm_name', '=', name)
    .executeTakeFirst();
  return held !== undefined && held.realm_id !== except;
}

export function createCentralRealmRepository(db: Kysely<Database>): CentralRealmRepository {
  return {
    realmTypes: () => db.selectFrom('mcrealm_realm_types').selectAll().orderBy('system_code').execute(),

    putRealmType: (systemCode, displayName, at) =>
      db.transaction().execute(async (trx) => {
        const held = await trx.selectFrom('mcrealm_realm_types').selectAll().where('system_code', '=', systemCode).executeTakeFirst();
        if (held === undefined) {
          await trx
            .insertInto('mcrealm_realm_types')
            .values({ system_code: systemCode, display_name: displayName, created_at: at, updated_at: at })
            .execute();
        } else if (held.display_name !== displayName) {
          await trx
            .updateTable('mcrealm_realm_types')
            .set({ display_name: displayName, updated_at: at })
            .where('id', '=', held.id)
            .execute();
        }
        return (await trx.selectFrom('mcrealm_realm_types').selectAll().where('system_code', '=', systemCode).executeTakeFirst())!;
      }),

    realms: () => realmQuery(db).orderBy('p.realm_name').execute(),

    realm: (id) => realmQuery(db).where('r.id', '=', id).executeTakeFirst(),

    createRealm: (realm, at) =>
      db.transaction().execute(async (trx): Promise<RealmResult<Realm>> => {
        const type = await trx.selectFrom('mcrealm_realm_types').select('id').where('system_code', '=', realm.realm_type).executeTakeFirst();
        if (type === undefined) return { ok: false, reason: 'type_not_found' };
        if ((await trx.selectFrom('mcrealm_realms').select('id').where('id', '=', realm.id).executeTakeFirst()) !== undefined) {
          return { ok: false, reason: 'id_taken' };
        }
        if (await nameTaken(trx, realm.realm_name, realm.id)) return { ok: false, reason: 'name_taken' };
        if (realm.account_type !== null && realm.account_uuid !== null) {
          await ensureAccountIn(trx, { accountType: realm.account_type, accountUuid: realm.account_uuid }, at);
        }
        await trx
          .insertInto('mcrealm_realms')
          .values({
            id: realm.id,
            realm_type_id: type.id,
            account_type: realm.account_type,
            account_uuid: realm.account_uuid,
            created_at: at,
            updated_at: at,
          })
          .execute();
        await trx
          .insertInto('mcrealm_realm_property')
          .values({ realm_id: realm.id, realm_name: realm.realm_name, display_name: realm.display_name, created_at: at, updated_at: at })
          .execute();
        return { ok: true, value: (await realmQuery(trx).where('r.id', '=', realm.id).executeTakeFirst())! };
      }),

    editRealm: (id, edit, at) =>
      db.transaction().execute(async (trx): Promise<RealmResult<Realm>> => {
        if ((await realmQuery(trx).where('r.id', '=', id).executeTakeFirst()) === undefined) return { ok: false, reason: 'not_found' };
        if (edit.realm_name !== undefined && (await nameTaken(trx, edit.realm_name, id))) return { ok: false, reason: 'name_taken' };
        const set: Record<string, string> = { updated_at: at };
        if (edit.realm_name !== undefined) set.realm_name = edit.realm_name;
        if (edit.display_name !== undefined) set.display_name = edit.display_name;
        await trx.updateTable('mcrealm_realm_property').set(set).where('realm_id', '=', id).execute();
        await trx.updateTable('mcrealm_realms').set({ updated_at: at }).where('id', '=', id).execute();
        return { ok: true, value: (await realmQuery(trx).where('r.id', '=', id).executeTakeFirst())! };
      }),

    deleteRealm: (id) =>
      db.transaction().execute(async (trx): Promise<RealmResult<true>> => {
        if ((await trx.selectFrom('mcrealm_realms').select('id').where('id', '=', id).executeTakeFirst()) === undefined) {
          return { ok: false, reason: 'not_found' };
        }
        const world = await trx.selectFrom('mcrealm_realm_world').select('world_id').where('realm_id', '=', id).executeTakeFirst();
        if (world !== undefined) return { ok: false, reason: 'has_worlds' };
        await trx.deleteFrom('mcrealm_realms').where('id', '=', id).execute();
        return { ok: true, value: true };
      }),

    assignWorld: (realmId, worldId, at) =>
      db.transaction().execute(async (trx): Promise<RealmResult<true>> => {
        if ((await trx.selectFrom('mcrealm_realms').select('id').where('id', '=', realmId).executeTakeFirst()) === undefined) {
          return { ok: false, reason: 'not_found' };
        }
        if ((await trx.selectFrom('universe_worlds').select('id').where('id', '=', worldId).executeTakeFirst()) === undefined) {
          return { ok: false, reason: 'world_not_found' };
        }
        await trx.deleteFrom('mcrealm_realm_world').where('world_id', '=', worldId).execute();
        await trx.insertInto('mcrealm_realm_world').values({ world_id: worldId, realm_id: realmId, created_at: at }).execute();
        return { ok: true, value: true };
      }),

    unassignWorld: async (realmId, worldId) => {
      const result = await db
        .deleteFrom('mcrealm_realm_world')
        .where('realm_id', '=', realmId)
        .where('world_id', '=', worldId)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    realmOfWorld: (worldId) =>
      realmQuery(db)
        .innerJoin('mcrealm_realm_world as w', 'w.realm_id', 'r.id')
        .where('w.world_id', '=', worldId)
        .executeTakeFirst(),
  };
}
