import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { serialPrimaryKey, type DialectTypes } from '../types.js';

/**
 * The MCIdentity family's central data: the core plugin's professions,
 * identities, sessions and logs, and the skill, rune and cosmetic add-ons.
 *
 * Every table is prefixed `mcidentity_` because this database already has an
 * `identities` table -- the OAuth identities of a person's account -- and the
 * two have nothing to do with each other.
 *
 * Shapes follow the plugin's own SQL backends, so a network moving from a
 * shared MySQL database to this server moves the same columns. Two departures:
 * a profession is keyed by its code, which is the only thing the client ever
 * sends, and an alias carries a lower-cased copy so "unique, ignoring case" is
 * a constraint rather than a query.
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

      await db.schema
        .createTable('mcidentity_identities')
        .addColumn('uuid', uuid, (c) => c.primaryKey())
        .addColumn('profession_code', code, (c) =>
          c.notNull().references('mcidentity_professions.system_code'),
        )
        .addColumn('alias', 'varchar(32)')
        // NULL when there is no alias; every engine's unique index ignores
        // NULLs, so any number of identities may have none.
        .addColumn('alias_key', 'varchar(32)', (c) => c.unique())
        .addColumn('level', 'integer', (c) => c.notNull())
        .addColumn('exp', 'integer', (c) => c.notNull())
        .addColumn('stat_points', 'integer', (c) => c.notNull())
        .addColumn('head_text', sql.raw(t.text))
        .addColumn('inventory_contents', sql.raw(t.text))
        .addColumn('enderchest_contents', sql.raw(t.text))
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('mcidentity_stats')
        .addColumn('identity_uuid', uuid, (c) =>
          c.primaryKey().references('mcidentity_identities.uuid').onDelete('cascade'),
        )
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

      // One player wears one identity, and one identity is worn by one player:
      // both columns are unique, as in the plugin's own schema.
      await db.schema
        .createTable('mcidentity_sessions')
        .addColumn('player_uuid', uuid, (c) => c.primaryKey())
        .addColumn('identity_uuid', uuid, (c) =>
          c.notNull().unique().references('mcidentity_identities.uuid').onDelete('cascade'),
        )
        .addColumn('content_key', sql.raw(t.text))
        .addColumn('equipped_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('mcidentity_logs')
        .addColumn('id', sql.raw(t.serial), serialPrimaryKey(t))
        .addColumn('player_uuid', uuid, (c) => c.notNull())
        .addColumn('identity_uuid', uuid, (c) => c.notNull())
        .addColumn('action_type', 'varchar(50)', (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('mcidentity_base_slots')
        .addColumn('player_uuid', uuid, (c) => c.primaryKey())
        .addColumn('slots', 'integer', (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      // Skills and runes are the same shape: a catalogue keyed by code, and
      // what each identity has in each numbered slot. The slot tables carry no
      // foreign key to the identity, because the add-ons write them on their
      // own schedule and a write that lands a moment before the identity's
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
          .addColumn('identity_uuid', uuid, (c) => c.notNull())
          .addColumn('slot', 'integer', (c) => c.notNull())
          .addColumn('item_code', 'varchar(255)', (c) => c.notNull())
          .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
          .addPrimaryKeyConstraint(`pk_mcidentity_equipped_${kind}`, ['identity_uuid', 'slot'])
          .execute();
      }

      await db.schema
        .createTable('mcidentity_cosmetics')
        .addColumn('identity_uuid', uuid, (c) => c.primaryKey())
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
        'mcidentity_base_slots',
        'mcidentity_logs',
        'mcidentity_sessions',
        'mcidentity_stats',
        'mcidentity_identities',
        'mcidentity_professions',
      ]) {
        await db.schema.dropTable(table).ifExists().execute();
      }
    },
  };
}
