import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { serialPrimaryKey, type DialectTypes } from '../types.js';

/**
 * The MCIdentity family's central data: the core plugin's professions, each
 * player's stats, worn profession, per profession progress and logs, and the
 * skill, rune and cosmetic add-ons. Every player row is keyed by the player
 * UUID: one character per player, wearing one profession at a time.
 *
 * Every table is prefixed `mcidentity_` because this database already has an
 * `identities` table -- the OAuth identities of a person's account -- and the
 * two have nothing to do with each other.
 *
 * Shapes follow the plugin's own SQL backends, so a network moving from a
 * shared MySQL database to this server moves the same columns. One departure:
 * a profession is keyed by its code, which is the only thing the client ever
 * sends.
 */
export function migration003CentralIdentity(t: DialectTypes): Migration {
  const uuid = 'varchar(36)';
  const code = 'varchar(64)';

  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await db.schema
        .createTable('mcidentity_professions')
        .addColumn('system_code', code, (c) => c.primaryKey())
        .addColumn('display_name', 'varchar(255)', (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      // One character per player: the nine stats and the unspent stat points.
      await db.schema
        .createTable('mcidentity_player_stats')
        .addColumn('player_uuid', uuid, (c) => c.primaryKey())
        .addColumn('stat_points', 'integer', (c) => c.notNull())
        .addColumn('energy', 'integer', (c) => c.notNull())
        .addColumn('health', 'integer', (c) => c.notNull())
        .addColumn('food', 'integer', (c) => c.notNull())
        .addColumn('strength', 'integer', (c) => c.notNull())
        .addColumn('defense', 'integer', (c) => c.notNull())
        .addColumn('wisdom', 'integer', (c) => c.notNull())
        .addColumn('luck', 'integer', (c) => c.notNull())
        .addColumn('agility', 'integer', (c) => c.notNull())
        .addColumn('resilience', 'integer', (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      // The one profession each player wears.
      await db.schema
        .createTable('mcidentity_player_professions')
        .addColumn('player_uuid', uuid, (c) => c.primaryKey())
        .addColumn('profession_code', code, (c) =>
          c.notNull().references('mcidentity_professions.system_code'),
        )
        .addColumn('equipped_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      // Level and EXP per player and profession, kept while another is worn.
      await db.schema
        .createTable('mcidentity_player_profession_progress')
        .addColumn('player_uuid', uuid, (c) => c.notNull())
        .addColumn('profession_code', code, (c) => c.notNull())
        .addColumn('level', 'integer', (c) => c.notNull())
        .addColumn('exp', 'integer', (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcidentity_player_profession_progress', [
          'player_uuid',
          'profession_code',
        ])
        .execute();

      await db.schema
        .createTable('mcidentity_profession_logs')
        .addColumn('id', sql.raw(t.serial), serialPrimaryKey(t))
        .addColumn('player_uuid', uuid, (c) => c.notNull())
        .addColumn('profession_code', code, (c) => c.notNull())
        .addColumn('action_type', 'varchar(50)', (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      // Skills and runes are the same shape: a catalogue keyed by code, and
      // what each player has in each numbered slot. The slot tables carry no
      // foreign key to the player, because the add-ons write them on their
      // own schedule and a write that lands a moment before the player's
      // would otherwise be lost.
      for (const kind of ['skills', 'runes'] as const) {
        await db.schema
          .createTable(`mcidentity_${kind}`)
          .addColumn('system_code', code, (c) => c.primaryKey())
          .addColumn('display_name', 'varchar(255)', (c) => c.notNull())
          .addColumn('item', sql.raw(t.text))
          .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
          .execute();

        await db.schema
          .createTable(`mcidentity_equipped_${kind}`)
          .addColumn('player_uuid', uuid, (c) => c.notNull())
          .addColumn('slot', 'integer', (c) => c.notNull())
          .addColumn('item_code', 'varchar(255)', (c) => c.notNull())
          .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
          .addPrimaryKeyConstraint(`pk_mcidentity_equipped_${kind}`, ['player_uuid', 'slot'])
          .execute();
      }

      await db.schema
        .createTable('mcidentity_cosmetics')
        .addColumn('player_uuid', uuid, (c) => c.primaryKey())
        .addColumn('skin', sql.raw(t.text))
        .addColumn('aura', sql.raw(t.text))
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      for (const table of [
        'mcidentity_cosmetics',
        'mcidentity_equipped_runes',
        'mcidentity_runes',
        'mcidentity_equipped_skills',
        'mcidentity_skills',
        'mcidentity_profession_logs',
        'mcidentity_player_profession_progress',
        'mcidentity_player_professions',
        'mcidentity_player_stats',
        'mcidentity_professions',
      ]) {
        await db.schema.dropTable(table).ifExists().execute();
      }
    },
  };
}
