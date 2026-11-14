import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../db/schema.js';

/**
 * An account as MCMultiverse and MCRealm key it: `player` with the player's
 * UUID, `clan`, `guild`, or any type another plugin defines, and its UUID.
 */
export interface AccountKey {
  accountType: string;
  accountUuid: string;
}

/** An account with the page limits its property row holds. */
export interface AccountView {
  account_type: string;
  account_uuid: string;
  inventory_page_limit: number;
  enderchest_page_limit: number;
  created_at: string;
  updated_at: string;
}

export interface PageLimits {
  inventory_page_limit?: number | undefined;
  enderchest_page_limit?: number | undefined;
}

/** The outcome of asking for an account's session lock. */
export type SessionResult =
  | { acquired: true; server_id: string; locked_at: string }
  | { acquired: false; held_by: string; locked_at: string };

/** A world with its property row. The owner is null for a server owned world. */
export interface World {
  id: string;
  world_name: string;
  environment: string;
  account_type: string | null;
  account_uuid: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorldInput {
  world_name: string;
  environment: string;
  account_type: string | null;
  account_uuid: string | null;
}

/** One chest block: 27 slots of Base64 contents at a block position. */
export interface Chest {
  id: string;
  world_id: string;
  x: number;
  y: number;
  z: number;
  contents: string;
  created_at: string;
  updated_at: string;
}

export interface BlockPosition {
  worldId: string;
  x: number;
  y: number;
  z: number;
}

/** Every query behind the tables MCMultiverse and MCRealm share. */
export interface UniverseRepository {
  /** Creates the account and its property row when absent. */
  ensureAccount(key: AccountKey, at: string): Promise<{ created: boolean; account: AccountView }>;
  account(key: AccountKey): Promise<AccountView | undefined>;
  /** Sets the given limits; undefined when the account does not exist. */
  setLimits(key: AccountKey, limits: PageLimits, at: string): Promise<AccountView | undefined>;
  /**
   * Takes the account's session lock for one game server, in one transaction:
   * granted when free, already held by that server, or older than
   * `staleSeconds`; refused with the holder otherwise.
   */
  acquireSession(key: AccountKey, serverId: string, staleSeconds: number, at: Date): Promise<SessionResult>;
  /** Releases the lock when this server holds it; false otherwise. */
  releaseSession(key: AccountKey, serverId: string): Promise<boolean>;
  worlds(): Promise<World[]>;
  world(id: string): Promise<World | undefined>;
  worldByName(name: string): Promise<World | undefined>;
  /** Creates or replaces a world; undefined when another world holds the name. */
  putWorld(id: string, input: WorldInput, at: string): Promise<World | undefined>;
  deleteWorld(id: string): Promise<boolean>;
  chest(position: BlockPosition): Promise<Chest | undefined>;
  /** Stores a chest's contents, creating the row with `newId` when absent; undefined when the world does not exist. */
  putChest(position: BlockPosition, contents: string, newId: string, at: string): Promise<Chest | undefined>;
  deleteChest(position: BlockPosition): Promise<boolean>;
}

type Db = Kysely<Database> | Transaction<Database>;

/** Creates the account and its property row when absent, inside a caller's transaction. */
export async function ensureAccountIn(trx: Db, key: AccountKey, at: string): Promise<boolean> {
  const held = await trx
    .selectFrom('universe_accounts')
    .select('account_type')
    .where('account_type', '=', key.accountType)
    .where('account_uuid', '=', key.accountUuid)
    .executeTakeFirst();
  if (held !== undefined) return false;
  const account = { account_type: key.accountType, account_uuid: key.accountUuid, created_at: at, updated_at: at };
  await trx.insertInto('universe_accounts').values(account).execute();
  await trx
    .insertInto('universe_account_property')
    .values({ ...account, inventory_page_limit: 1, enderchest_page_limit: 1 })
    .execute();
  return true;
}

function readAccount(db: Db, key: AccountKey): Promise<AccountView | undefined> {
  return db
    .selectFrom('universe_accounts as a')
    .innerJoin('universe_account_property as p', (j) =>
      j.onRef('p.account_type', '=', 'a.account_type').onRef('p.account_uuid', '=', 'a.account_uuid'),
    )
    .select([
      'a.account_type',
      'a.account_uuid',
      'p.inventory_page_limit',
      'p.enderchest_page_limit',
      'a.created_at',
      'p.updated_at',
    ])
    .where('a.account_type', '=', key.accountType)
    .where('a.account_uuid', '=', key.accountUuid)
    .executeTakeFirst();
}

function worldQuery(db: Db) {
  return db
    .selectFrom('universe_worlds as w')
    .innerJoin('universe_world_property as p', 'p.world_id', 'w.id')
    .select(['w.id', 'p.world_name', 'p.environment', 'w.account_type', 'w.account_uuid', 'w.created_at', 'p.updated_at']);
}

function chestQuery(db: Db, position: BlockPosition) {
  return db
    .selectFrom('universe_world_chest')
    .selectAll()
    .where('world_id', '=', position.worldId)
    .where('x', '=', position.x)
    .where('y', '=', position.y)
    .where('z', '=', position.z);
}

export function createUniverseRepository(db: Kysely<Database>): UniverseRepository {
  return {
    ensureAccount: (key, at) =>
      db.transaction().execute(async (trx) => {
        const created = await ensureAccountIn(trx, key, at);
        return { created, account: (await readAccount(trx, key))! };
      }),

    account: (key) => readAccount(db, key),

    setLimits: (key, limits, at) =>
      db.transaction().execute(async (trx) => {
        if ((await readAccount(trx, key)) === undefined) return undefined;
        const set: Record<string, number | string> = { updated_at: at };
        if (limits.inventory_page_limit !== undefined) set.inventory_page_limit = limits.inventory_page_limit;
        if (limits.enderchest_page_limit !== undefined) set.enderchest_page_limit = limits.enderchest_page_limit;
        await trx
          .updateTable('universe_account_property')
          .set(set)
          .where('account_type', '=', key.accountType)
          .where('account_uuid', '=', key.accountUuid)
          .execute();
        return readAccount(trx, key);
      }),

    acquireSession: (key, serverId, staleSeconds, at) =>
      db.transaction().execute(async (trx): Promise<SessionResult> => {
        const now = at.toISOString();
        await ensureAccountIn(trx, key, now);
        const held = await trx
          .selectFrom('universe_account_session')
          .selectAll()
          .where('account_type', '=', key.accountType)
          .where('account_uuid', '=', key.accountUuid)
          .executeTakeFirst();
        if (held === undefined) {
          await trx
            .insertInto('universe_account_session')
            .values({ account_type: key.accountType, account_uuid: key.accountUuid, server_id: serverId, locked_at: now })
            .execute();
          return { acquired: true, server_id: serverId, locked_at: now };
        }
        const age = at.getTime() - new Date(held.locked_at).getTime();
        if (held.server_id !== serverId && age < staleSeconds * 1000) {
          return { acquired: false, held_by: held.server_id, locked_at: new Date(held.locked_at).toISOString() };
        }
        await trx
          .updateTable('universe_account_session')
          .set({ server_id: serverId, locked_at: now })
          .where('account_type', '=', key.accountType)
          .where('account_uuid', '=', key.accountUuid)
          .execute();
        return { acquired: true, server_id: serverId, locked_at: now };
      }),

    releaseSession: async (key, serverId) => {
      const result = await db
        .deleteFrom('universe_account_session')
        .where('account_type', '=', key.accountType)
        .where('account_uuid', '=', key.accountUuid)
        .where('server_id', '=', serverId)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    worlds: () => worldQuery(db).orderBy('p.world_name').execute(),

    world: (id) => worldQuery(db).where('w.id', '=', id).executeTakeFirst(),

    worldByName: (name) => worldQuery(db).where('p.world_name', '=', name).executeTakeFirst(),

    putWorld: (id, input, at) =>
      db.transaction().execute(async (trx) => {
        const named = await trx
          .selectFrom('universe_world_property')
          .select('world_id')
          .where('world_name', '=', input.world_name)
          .executeTakeFirst();
        if (named !== undefined && named.world_id !== id) return undefined;
        if (input.account_type !== null && input.account_uuid !== null) {
          await ensureAccountIn(trx, { accountType: input.account_type, accountUuid: input.account_uuid }, at);
        }
        const owner = { account_type: input.account_type, account_uuid: input.account_uuid };
        const property = { world_name: input.world_name, environment: input.environment };
        const held = await trx.selectFrom('universe_worlds').select('id').where('id', '=', id).executeTakeFirst();
        if (held === undefined) {
          await trx.insertInto('universe_worlds').values({ id, ...owner, created_at: at, updated_at: at }).execute();
          await trx
            .insertInto('universe_world_property')
            .values({ world_id: id, ...property, created_at: at, updated_at: at })
            .execute();
        } else {
          await trx.updateTable('universe_worlds').set({ ...owner, updated_at: at }).where('id', '=', id).execute();
          await trx
            .updateTable('universe_world_property')
            .set({ ...property, updated_at: at })
            .where('world_id', '=', id)
            .execute();
        }
        return worldQuery(trx).where('w.id', '=', id).executeTakeFirst();
      }),

    deleteWorld: async (id) => {
      const result = await db.deleteFrom('universe_worlds').where('id', '=', id).executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    chest: (position) => chestQuery(db, position).executeTakeFirst(),

    putChest: (position, contents, newId, at) =>
      db.transaction().execute(async (trx) => {
        const world = await trx.selectFrom('universe_worlds').select('id').where('id', '=', position.worldId).executeTakeFirst();
        if (world === undefined) return undefined;
        const held = await chestQuery(trx, position).executeTakeFirst();
        if (held === undefined) {
          const row: Chest = {
            id: newId,
            world_id: position.worldId,
            x: position.x,
            y: position.y,
            z: position.z,
            contents,
            created_at: at,
            updated_at: at,
          };
          await trx.insertInto('universe_world_chest').values(row).execute();
          return row;
        }
        await trx.updateTable('universe_world_chest').set({ contents, updated_at: at }).where('id', '=', held.id).execute();
        return { ...held, contents, updated_at: at };
      }),

    deleteChest: async (position) => {
      const result = await db
        .deleteFrom('universe_world_chest')
        .where('world_id', '=', position.worldId)
        .where('x', '=', position.x)
        .where('y', '=', position.y)
        .where('z', '=', position.z)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },
  };
}
