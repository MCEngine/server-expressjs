import type { Kysely } from 'kysely';
import type { Database } from '../../../db/schema.js';

export const STAT_KEYS = [
  'energy',
  'health',
  'food',
  'strength',
  'defense',
  'wisdom',
  'luck',
  'agility',
  'resilience',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export interface IdentityProperties {
  alias: string | null;
  level: number;
  exp: number;
  statPoints: number;
  headText: string | null;
  inventoryContents: string | null;
  enderchestContents: string | null;
}

export interface CatalogueEntry {
  systemCode: string;
  displayName: string;
  item: string | null;
}

/** The two slot-based add-ons share one shape and differ only in the table. */
export type SlotKind = 'skills' | 'runes';

/**
 * Every query the MCIdentity family's central routes run. No rules live here:
 * what the plugin would refuse, the routes refuse before calling in.
 */
export interface CentralIdentityRepository {
  addProfession(systemCode: string, displayName: string, at: string): Promise<void>;
  professions(): Promise<{ systemCode: string; displayName: string }[]>;
  professionExists(systemCode: string): Promise<boolean>;

  /** False when an identity with this UUID already exists. */
  createIdentity(input: {
    uuid: string;
    professionCode: string;
    properties: Omit<IdentityProperties, 'alias' | 'inventoryContents' | 'enderchestContents'>;
    stats: Stats;
    at: string;
  }): Promise<boolean>;
  professionOf(uuid: string): Promise<string | undefined>;
  properties(uuid: string): Promise<IdentityProperties | undefined>;
  updateProperties(
    uuid: string,
    properties: Omit<IdentityProperties, 'alias'>,
    at: string,
  ): Promise<boolean>;
  byAlias(aliasKey: string): Promise<string | undefined>;
  /** `taken` when another identity already holds the alias. */
  setAlias(uuid: string, alias: string | null, at: string): Promise<'ok' | 'missing' | 'taken'>;

  stats(uuid: string): Promise<Stats | undefined>;
  updateStats(uuid: string, stats: Stats, at: string): Promise<boolean>;
  addStat(uuid: string, key: StatKey, amount: number, at: string): Promise<boolean>;

  session(playerUuid: string): Promise<{ identityUuid: string; contentKey: string | null } | undefined>;
  /** Puts the player in this identity, taking it off whoever wore it before. */
  setSession(playerUuid: string, identityUuid: string, contentKey: string | null, at: string): Promise<boolean>;
  clearSession(playerUuid: string): Promise<void>;
  setContentKey(playerUuid: string, contentKey: string | null): Promise<void>;

  log(playerUuid: string, identityUuid: string, actionType: string, at: string): Promise<void>;

  baseSlots(playerUuid: string): Promise<number>;
  addBaseSlots(playerUuid: string, amount: number, at: string): Promise<number>;

  addCatalogue(kind: SlotKind, entry: CatalogueEntry, at: string): Promise<void>;
  catalogue(kind: SlotKind): Promise<CatalogueEntry[]>;
  equipped(kind: SlotKind, identityUuid: string): Promise<Record<string, string>>;
  equip(kind: SlotKind, identityUuid: string, slot: number, value: string | null, at: string): Promise<void>;

  cosmetics(identityUuid: string): Promise<{ skin: string | null; aura: string | null } | undefined>;
  saveCosmetics(
    identityUuid: string,
    patch: { skin?: string | null | undefined; aura?: string | null | undefined },
    at: string,
  ): Promise<void>;
}

const statsOf = (row: Stats): Stats =>
  Object.fromEntries(STAT_KEYS.map((key) => [key, row[key]])) as Stats;

export function createCentralIdentityRepository(db: Kysely<Database>): CentralIdentityRepository {
  const exists = async (uuid: string) =>
    (await db
      .selectFrom('mcidentity_identities')
      .select('uuid')
      .where('uuid', '=', uuid)
      .executeTakeFirst()) !== undefined;

  return {
    async addProfession(systemCode, displayName, at) {
      // The plugin registers every profession it loads on every start, so a
      // second registration is the normal case and keeps the first name, as
      // the plugin's own `INSERT OR IGNORE` does.
      // No `onConflict`: MySQL spells it differently, so a check inside one
      // transaction keeps this portable, as the auth repository does.
      await db.transaction().execute(async (trx) => {
        const known = await trx
          .selectFrom('mcidentity_professions')
          .select('system_code')
          .where('system_code', '=', systemCode)
          .executeTakeFirst();
        if (known !== undefined) return;
        await trx
          .insertInto('mcidentity_professions')
          .values({ system_code: systemCode, display_name: displayName, created_at: at })
          .execute();
      });
    },

    async professions() {
      const rows = await db
        .selectFrom('mcidentity_professions')
        .select(['system_code', 'display_name'])
        .orderBy('system_code')
        .execute();
      return rows.map((r) => ({ systemCode: r.system_code, displayName: r.display_name }));
    },

    async professionExists(systemCode) {
      return (
        (await db
          .selectFrom('mcidentity_professions')
          .select('system_code')
          .where('system_code', '=', systemCode)
          .executeTakeFirst()) !== undefined
      );
    },

    async createIdentity({ uuid, professionCode, properties, stats, at }) {
      return db.transaction().execute(async (trx) => {
        const taken = await trx
          .selectFrom('mcidentity_identities')
          .select('uuid')
          .where('uuid', '=', uuid)
          .executeTakeFirst();
        if (taken !== undefined) return false;

        await trx
          .insertInto('mcidentity_identities')
          .values({
            uuid,
            profession_code: professionCode,
            alias: null,
            alias_key: null,
            level: properties.level,
            exp: properties.exp,
            stat_points: properties.statPoints,
            head_text: properties.headText,
            inventory_contents: null,
            enderchest_contents: null,
            created_at: at,
            updated_at: at,
          })
          .execute();
        await trx
          .insertInto('mcidentity_stats')
          .values({ identity_uuid: uuid, ...stats, updated_at: at })
          .execute();
        return true;
      });
    },

    async professionOf(uuid) {
      const row = await db
        .selectFrom('mcidentity_identities')
        .select('profession_code')
        .where('uuid', '=', uuid)
        .executeTakeFirst();
      return row?.profession_code;
    },

    async properties(uuid) {
      const row = await db
        .selectFrom('mcidentity_identities')
        .selectAll()
        .where('uuid', '=', uuid)
        .executeTakeFirst();
      if (row === undefined) return undefined;
      return {
        alias: row.alias,
        level: row.level,
        exp: row.exp,
        statPoints: row.stat_points,
        headText: row.head_text,
        inventoryContents: row.inventory_contents,
        enderchestContents: row.enderchest_contents,
      };
    },

    async updateProperties(uuid, p, at) {
      const result = await db
        .updateTable('mcidentity_identities')
        .set({
          level: p.level,
          exp: p.exp,
          stat_points: p.statPoints,
          head_text: p.headText,
          inventory_contents: p.inventoryContents,
          enderchest_contents: p.enderchestContents,
          updated_at: at,
        })
        .where('uuid', '=', uuid)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    async byAlias(aliasKey) {
      const row = await db
        .selectFrom('mcidentity_identities')
        .select('uuid')
        .where('alias_key', '=', aliasKey)
        .executeTakeFirst();
      return row?.uuid;
    },

    async setAlias(uuid, alias, at) {
      return db.transaction().execute(async (trx) => {
        const key = alias === null ? null : alias.toLowerCase();
        if (key !== null) {
          const holder = await trx
            .selectFrom('mcidentity_identities')
            .select('uuid')
            .where('alias_key', '=', key)
            .executeTakeFirst();
          if (holder !== undefined && holder.uuid !== uuid) return 'taken' as const;
        }
        const result = await trx
          .updateTable('mcidentity_identities')
          .set({ alias, alias_key: key, updated_at: at })
          .where('uuid', '=', uuid)
          .executeTakeFirst();
        return Number(result.numUpdatedRows) > 0 ? ('ok' as const) : ('missing' as const);
      });
    },

    async stats(uuid) {
      const row = await db
        .selectFrom('mcidentity_stats')
        .selectAll()
        .where('identity_uuid', '=', uuid)
        .executeTakeFirst();
      return row === undefined ? undefined : statsOf(row);
    },

    async updateStats(uuid, stats, at) {
      const result = await db
        .updateTable('mcidentity_stats')
        .set({ ...stats, updated_at: at })
        .where('identity_uuid', '=', uuid)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    async addStat(uuid, key, amount, at) {
      // One statement, so two servers adding at once both land.
      const result = await db
        .updateTable('mcidentity_stats')
        .set((eb) => ({ [key]: eb(key, '+', amount), updated_at: at }))
        .where('identity_uuid', '=', uuid)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    async session(playerUuid) {
      const row = await db
        .selectFrom('mcidentity_sessions')
        .select(['identity_uuid', 'content_key'])
        .where('player_uuid', '=', playerUuid)
        .executeTakeFirst();
      return row === undefined ? undefined : { identityUuid: row.identity_uuid, contentKey: row.content_key };
    },

    async setSession(playerUuid, identityUuid, contentKey, at) {
      if (!(await exists(identityUuid))) return false;
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('mcidentity_sessions')
          .where((eb) => eb.or([eb('player_uuid', '=', playerUuid), eb('identity_uuid', '=', identityUuid)]))
          .execute();
        await trx
          .insertInto('mcidentity_sessions')
          .values({ player_uuid: playerUuid, identity_uuid: identityUuid, content_key: contentKey, equipped_at: at })
          .execute();
      });
      return true;
    },

    async clearSession(playerUuid) {
      await db.deleteFrom('mcidentity_sessions').where('player_uuid', '=', playerUuid).execute();
    },

    async setContentKey(playerUuid, contentKey) {
      await db
        .updateTable('mcidentity_sessions')
        .set({ content_key: contentKey })
        .where('player_uuid', '=', playerUuid)
        .execute();
    },

    async log(playerUuid, identityUuid, actionType, at) {
      await db
        .insertInto('mcidentity_logs')
        .values({ player_uuid: playerUuid, identity_uuid: identityUuid, action_type: actionType, created_at: at })
        .execute();
    },

    async baseSlots(playerUuid) {
      const row = await db
        .selectFrom('mcidentity_base_slots')
        .select('slots')
        .where('player_uuid', '=', playerUuid)
        .executeTakeFirst();
      return row?.slots ?? 0;
    },

    async addBaseSlots(playerUuid, amount, at) {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('mcidentity_base_slots')
          .select('slots')
          .where('player_uuid', '=', playerUuid)
          .executeTakeFirst();
        // Never below zero, as the plugin's own backends clamp it.
        const slots = Math.max(0, (row?.slots ?? 0) + amount);
        if (row === undefined) {
          await trx
            .insertInto('mcidentity_base_slots')
            .values({ player_uuid: playerUuid, slots, updated_at: at })
            .execute();
        } else {
          await trx
            .updateTable('mcidentity_base_slots')
            .set({ slots, updated_at: at })
            .where('player_uuid', '=', playerUuid)
            .execute();
        }
        return slots;
      });
    },

    async addCatalogue(kind, entry, at) {
      const table = `mcidentity_${kind}` as const;
      await db.transaction().execute(async (trx) => {
        const result = await trx
          .updateTable(table)
          .set({ display_name: entry.displayName, item: entry.item })
          .where('system_code', '=', entry.systemCode)
          .executeTakeFirst();
        if (Number(result.numUpdatedRows) > 0) return;
        await trx
          .insertInto(table)
          .values({
            system_code: entry.systemCode,
            display_name: entry.displayName,
            item: entry.item,
            created_at: at,
          })
          .execute();
      });
    },

    async catalogue(kind) {
      const rows = await db
        .selectFrom(`mcidentity_${kind}`)
        .select(['system_code', 'display_name', 'item'])
        .orderBy('system_code')
        .execute();
      return rows.map((r) => ({ systemCode: r.system_code, displayName: r.display_name, item: r.item }));
    },

    async equipped(kind, identityUuid) {
      const rows = await db
        .selectFrom(`mcidentity_equipped_${kind}`)
        .select(['slot', 'item_code'])
        .where('identity_uuid', '=', identityUuid)
        .orderBy('slot')
        .execute();
      return Object.fromEntries(rows.map((r) => [String(r.slot), r.item_code]));
    },

    async equip(kind, identityUuid, slot, value, at) {
      const table = `mcidentity_equipped_${kind}` as const;
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom(table)
          .where('identity_uuid', '=', identityUuid)
          .where('slot', '=', slot)
          .execute();
        if (value !== null) {
          await trx
            .insertInto(table)
            .values({ identity_uuid: identityUuid, slot, item_code: value, updated_at: at })
            .execute();
        }
      });
    },

    async cosmetics(identityUuid) {
      const row = await db
        .selectFrom('mcidentity_cosmetics')
        .select(['skin', 'aura'])
        .where('identity_uuid', '=', identityUuid)
        .executeTakeFirst();
      return row;
    },

    async saveCosmetics(identityUuid, patch, at) {
      await db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('mcidentity_cosmetics')
          .select(['skin', 'aura'])
          .where('identity_uuid', '=', identityUuid)
          .executeTakeFirst();
        const next = {
          skin: patch.skin !== undefined ? patch.skin : (row?.skin ?? null),
          aura: patch.aura !== undefined ? patch.aura : (row?.aura ?? null),
        };
        if (row === undefined) {
          await trx
            .insertInto('mcidentity_cosmetics')
            .values({ identity_uuid: identityUuid, ...next, updated_at: at })
            .execute();
        } else {
          await trx
            .updateTable('mcidentity_cosmetics')
            .set({ ...next, updated_at: at })
            .where('identity_uuid', '=', identityUuid)
            .execute();
        }
      });
    },
  };
}
