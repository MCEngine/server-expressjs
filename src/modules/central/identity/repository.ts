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

/** The nine stats and the unspent stat points of one player. */
export type Stats = Record<StatKey, number> & { statPoints: number };

export interface Progress {
  level: number;
  exp: number;
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
 * what the plugin would refuse, the routes refuse before calling in. Every
 * player row is keyed by the player UUID.
 */
export interface CentralIdentityRepository {
  addProfession(systemCode: string, displayName: string, at: string): Promise<void>;
  professions(): Promise<{ systemCode: string; displayName: string }[]>;
  professionExists(systemCode: string): Promise<boolean>;

  /** Creates the player's stats row; false when the player already has one. */
  createPlayer(playerUuid: string, stats: Stats, at: string): Promise<boolean>;
  stats(playerUuid: string): Promise<Stats | undefined>;
  updateStats(playerUuid: string, stats: Stats, at: string): Promise<boolean>;
  addStat(playerUuid: string, key: StatKey, amount: number, at: string): Promise<boolean>;

  activeProfession(playerUuid: string): Promise<string | undefined>;
  setActiveProfession(playerUuid: string, professionCode: string, at: string): Promise<void>;

  progress(playerUuid: string, professionCode: string): Promise<Progress | undefined>;
  saveProgress(playerUuid: string, professionCode: string, progress: Progress, at: string): Promise<void>;

  log(playerUuid: string, professionCode: string, actionType: string, at: string): Promise<void>;

  addCatalogue(kind: SlotKind, entry: CatalogueEntry, at: string): Promise<void>;
  catalogue(kind: SlotKind): Promise<CatalogueEntry[]>;
  equipped(kind: SlotKind, playerUuid: string): Promise<Record<string, string>>;
  equip(kind: SlotKind, playerUuid: string, slot: number, value: string | null, at: string): Promise<void>;

  cosmetics(playerUuid: string): Promise<{ skin: string | null; aura: string | null } | undefined>;
  saveCosmetics(
    playerUuid: string,
    patch: { skin?: string | null | undefined; aura?: string | null | undefined },
    at: string,
  ): Promise<void>;
}

const statsOf = (row: Record<StatKey, number> & { stat_points: number }): Stats =>
  ({
    statPoints: row.stat_points,
    ...Object.fromEntries(STAT_KEYS.map((key) => [key, row[key]])),
  }) as Stats;

const statColumns = (stats: Stats) => {
  const { statPoints, ...rest } = stats;
  return { stat_points: statPoints, ...rest };
};

export function createCentralIdentityRepository(db: Kysely<Database>): CentralIdentityRepository {
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

    async createPlayer(playerUuid, stats, at) {
      return db.transaction().execute(async (trx) => {
        const known = await trx
          .selectFrom('mcidentity_player_stats')
          .select('player_uuid')
          .where('player_uuid', '=', playerUuid)
          .executeTakeFirst();
        if (known !== undefined) return false;
        await trx
          .insertInto('mcidentity_player_stats')
          .values({ player_uuid: playerUuid, ...statColumns(stats), updated_at: at })
          .execute();
        return true;
      });
    },

    async stats(playerUuid) {
      const row = await db
        .selectFrom('mcidentity_player_stats')
        .selectAll()
        .where('player_uuid', '=', playerUuid)
        .executeTakeFirst();
      return row === undefined ? undefined : statsOf(row);
    },

    async updateStats(playerUuid, stats, at) {
      const result = await db
        .updateTable('mcidentity_player_stats')
        .set({ ...statColumns(stats), updated_at: at })
        .where('player_uuid', '=', playerUuid)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    async addStat(playerUuid, key, amount, at) {
      // One statement, so two servers adding at once both land.
      const result = await db
        .updateTable('mcidentity_player_stats')
        .set((eb) => ({ [key]: eb(key, '+', amount), updated_at: at }))
        .where('player_uuid', '=', playerUuid)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    async activeProfession(playerUuid) {
      const row = await db
        .selectFrom('mcidentity_player_professions')
        .select('profession_code')
        .where('player_uuid', '=', playerUuid)
        .executeTakeFirst();
      return row?.profession_code;
    },

    async setActiveProfession(playerUuid, professionCode, at) {
      await db.transaction().execute(async (trx) => {
        const result = await trx
          .updateTable('mcidentity_player_professions')
          .set({ profession_code: professionCode, equipped_at: at })
          .where('player_uuid', '=', playerUuid)
          .executeTakeFirst();
        if (Number(result.numUpdatedRows) > 0) return;
        await trx
          .insertInto('mcidentity_player_professions')
          .values({ player_uuid: playerUuid, profession_code: professionCode, equipped_at: at })
          .execute();
      });
    },

    async progress(playerUuid, professionCode) {
      const row = await db
        .selectFrom('mcidentity_player_profession_progress')
        .select(['level', 'exp'])
        .where('player_uuid', '=', playerUuid)
        .where('profession_code', '=', professionCode)
        .executeTakeFirst();
      return row === undefined ? undefined : { level: row.level, exp: row.exp };
    },

    async saveProgress(playerUuid, professionCode, progress, at) {
      await db.transaction().execute(async (trx) => {
        const result = await trx
          .updateTable('mcidentity_player_profession_progress')
          .set({ level: progress.level, exp: progress.exp, updated_at: at })
          .where('player_uuid', '=', playerUuid)
          .where('profession_code', '=', professionCode)
          .executeTakeFirst();
        if (Number(result.numUpdatedRows) > 0) return;
        await trx
          .insertInto('mcidentity_player_profession_progress')
          .values({
            player_uuid: playerUuid,
            profession_code: professionCode,
            level: progress.level,
            exp: progress.exp,
            updated_at: at,
          })
          .execute();
      });
    },

    async log(playerUuid, professionCode, actionType, at) {
      await db
        .insertInto('mcidentity_profession_logs')
        .values({ player_uuid: playerUuid, profession_code: professionCode, action_type: actionType, created_at: at })
        .execute();
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

    async equipped(kind, playerUuid) {
      const rows = await db
        .selectFrom(`mcidentity_equipped_${kind}`)
        .select(['slot', 'item_code'])
        .where('player_uuid', '=', playerUuid)
        .orderBy('slot')
        .execute();
      return Object.fromEntries(rows.map((r) => [String(r.slot), r.item_code]));
    },

    async equip(kind, playerUuid, slot, value, at) {
      const table = `mcidentity_equipped_${kind}` as const;
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom(table)
          .where('player_uuid', '=', playerUuid)
          .where('slot', '=', slot)
          .execute();
        if (value !== null) {
          await trx
            .insertInto(table)
            .values({ player_uuid: playerUuid, slot, item_code: value, updated_at: at })
            .execute();
        }
      });
    },

    async cosmetics(playerUuid) {
      const row = await db
        .selectFrom('mcidentity_cosmetics')
        .select(['skin', 'aura'])
        .where('player_uuid', '=', playerUuid)
        .executeTakeFirst();
      return row;
    },

    async saveCosmetics(playerUuid, patch, at) {
      await db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('mcidentity_cosmetics')
          .select(['skin', 'aura'])
          .where('player_uuid', '=', playerUuid)
          .executeTakeFirst();
        const next = {
          skin: patch.skin !== undefined ? patch.skin : (row?.skin ?? null),
          aura: patch.aura !== undefined ? patch.aura : (row?.aura ?? null),
        };
        if (row === undefined) {
          await trx
            .insertInto('mcidentity_cosmetics')
            .values({ player_uuid: playerUuid, ...next, updated_at: at })
            .execute();
        } else {
          await trx
            .updateTable('mcidentity_cosmetics')
            .set({ ...next, updated_at: at })
            .where('player_uuid', '=', playerUuid)
            .execute();
        }
      });
    },
  };
}
