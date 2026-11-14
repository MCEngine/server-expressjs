import { sql, type CreateTableBuilder, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { serialPrimaryKey, type DialectTypes } from '../types.js';

/**
 * MCMultiverse's and MCRealm's central storage.
 *
 * Both plugins key an account by `account_type` + `account_uuid`, as MCEconomy
 * does. The tables the two plugins share carry a `universe_` prefix, because
 * this service already owns a web `accounts` table; the rest are named for the
 * plugin. Columns match the plugins' own SQL schema one for one, so a row means
 * the same thing here and in a game server's local database.
 *
 * Item contents are Base64 strings that can pass the 64 KB of a MySQL `text`,
 * so they use `longText`.
 */
export function migration010CentralUniverse(t: DialectTypes): Migration {
  const uuid = 'varchar(36)';
  const code = 'varchar(50)';
  const name = 'varchar(64)';
  const ts = sql.raw(t.timestamp);
  const contents = sql.raw(t.longText);
  const serial = serialPrimaryKey(t);

  /** The account columns and their composite key into `universe_accounts`. */
  // Loosely typed on purpose: each table adds its own columns after these.
  const accountKey = (table: CreateTableBuilder<string, any>, fk: string): CreateTableBuilder<string, any> =>
    table
      .addColumn('account_type', code, (c) => c.notNull())
      .addColumn('account_uuid', uuid, (c) => c.notNull())
      .addForeignKeyConstraint(fk, ['account_type', 'account_uuid'], 'universe_accounts', ['account_type', 'account_uuid'], (c) =>
        c.onDelete('cascade'),
      );

  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await db.schema
        .createTable('universe_accounts')
        .addColumn('account_type', code, (c) => c.notNull())
        .addColumn('account_uuid', uuid, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_universe_accounts', ['account_type', 'account_uuid'])
        .execute();

      await accountKey(db.schema.createTable('universe_account_property'), 'fk_universe_account_property_account')
        .addColumn('inventory_page_limit', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('enderchest_page_limit', 'integer', (c) => c.notNull().defaultTo(1))
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_universe_account_property', ['account_type', 'account_uuid'])
        .execute();

      await accountKey(db.schema.createTable('universe_account_session'), 'fk_universe_account_session_account')
        .addColumn('server_id', uuid, (c) => c.notNull())
        .addColumn('locked_at', ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_universe_account_session', ['account_type', 'account_uuid'])
        .execute();

      // A world's owner is optional: a lobby or a farm world belongs to the server.
      await db.schema
        .createTable('universe_worlds')
        .addColumn('id', uuid, (c) => c.primaryKey())
        .addColumn('account_type', code)
        .addColumn('account_uuid', uuid)
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .addForeignKeyConstraint(
          'fk_universe_worlds_owner',
          ['account_type', 'account_uuid'],
          'universe_accounts',
          ['account_type', 'account_uuid'],
          (c) => c.onDelete('restrict'),
        )
        .execute();

      await db.schema
        .createTable('universe_world_property')
        .addColumn('world_id', uuid, (c) => c.primaryKey().references('universe_worlds.id').onDelete('cascade'))
        .addColumn('world_name', name, (c) => c.notNull().unique())
        .addColumn('environment', code, (c) => c.notNull().defaultTo('normal'))
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .execute();

      // One row per chest block: a double chest is two rows, so breaking one half
      // touches only that half.
      await db.schema
        .createTable('universe_world_chest')
        .addColumn('id', uuid, (c) => c.primaryKey())
        .addColumn('world_id', uuid, (c) => c.notNull().references('universe_worlds.id').onDelete('cascade'))
        .addColumn('x', 'integer', (c) => c.notNull())
        .addColumn('y', 'integer', (c) => c.notNull())
        .addColumn('z', 'integer', (c) => c.notNull())
        .addColumn('contents', contents, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .addUniqueConstraint('uq_universe_world_chest_block', ['world_id', 'x', 'y', 'z'])
        .execute();

      for (const kind of ['inventory', 'enderchest'] as const) {
        await accountKey(db.schema.createTable(`mcmultiverse_account_${kind}`), `fk_mcmultiverse_account_${kind}_account`)
          .addColumn('page_number', 'integer', (c) => c.notNull())
          .addColumn('contents', contents, (c) => c.notNull())
          .addColumn('created_at', ts, (c) => c.notNull())
          .addColumn('updated_at', ts, (c) => c.notNull())
          .addPrimaryKeyConstraint(`pk_mcmultiverse_account_${kind}`, ['account_type', 'account_uuid', 'page_number'])
          .execute();
      }

      await accountKey(db.schema.createTable('mcmultiverse_account_equipment'), 'fk_mcmultiverse_account_equipment_account')
        .addColumn('contents', contents, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcmultiverse_account_equipment', ['account_type', 'account_uuid'])
        .execute();

      await db.schema
        .createTable('mcrealm_realm_types')
        .addColumn('id', sql.raw(t.serial), serial)
        .addColumn('system_code', code, (c) => c.notNull().unique())
        .addColumn('display_name', name, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .execute();

      // A realm's owner is optional: a personal realm has one, a season does not.
      await db.schema
        .createTable('mcrealm_realms')
        .addColumn('id', uuid, (c) => c.primaryKey())
        .addColumn('realm_type_id', 'integer', (c) => c.notNull().references('mcrealm_realm_types.id').onDelete('restrict'))
        .addColumn('account_type', code)
        .addColumn('account_uuid', uuid)
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .addForeignKeyConstraint(
          'fk_mcrealm_realms_owner',
          ['account_type', 'account_uuid'],
          'universe_accounts',
          ['account_type', 'account_uuid'],
          (c) => c.onDelete('restrict'),
        )
        .execute();

      await db.schema
        .createTable('mcrealm_realm_property')
        .addColumn('realm_id', uuid, (c) => c.primaryKey().references('mcrealm_realms.id').onDelete('cascade'))
        .addColumn('realm_name', name, (c) => c.notNull().unique())
        .addColumn('display_name', name, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .execute();

      // A world belongs to exactly one realm.
      await db.schema
        .createTable('mcrealm_realm_world')
        .addColumn('world_id', uuid, (c) => c.primaryKey().references('universe_worlds.id').onDelete('cascade'))
        .addColumn('realm_id', uuid, (c) => c.notNull().references('mcrealm_realms.id').onDelete('restrict'))
        .addColumn('created_at', ts, (c) => c.notNull())
        .execute();

      for (const kind of ['inventory', 'enderchest'] as const) {
        await accountKey(
          db.schema
            .createTable(`mcrealm_account_${kind}`)
            .addColumn('realm_id', uuid, (c) => c.notNull().references('mcrealm_realms.id').onDelete('cascade')),
          `fk_mcrealm_account_${kind}_account`,
        )
          .addColumn('page_number', 'integer', (c) => c.notNull())
          .addColumn('contents', contents, (c) => c.notNull())
          .addColumn('created_at', ts, (c) => c.notNull())
          .addColumn('updated_at', ts, (c) => c.notNull())
          .addPrimaryKeyConstraint(`pk_mcrealm_account_${kind}`, ['realm_id', 'account_type', 'account_uuid', 'page_number'])
          .execute();
      }

      await accountKey(
        db.schema
          .createTable('mcrealm_account_equipment')
          .addColumn('realm_id', uuid, (c) => c.notNull().references('mcrealm_realms.id').onDelete('cascade')),
        'fk_mcrealm_account_equipment_account',
      )
        .addColumn('contents', contents, (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcrealm_account_equipment', ['realm_id', 'account_type', 'account_uuid'])
        .execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      for (const table of [
        'mcrealm_account_equipment',
        'mcrealm_account_enderchest',
        'mcrealm_account_inventory',
        'mcrealm_realm_world',
        'mcrealm_realm_property',
        'mcrealm_realms',
        'mcrealm_realm_types',
        'mcmultiverse_account_equipment',
        'mcmultiverse_account_enderchest',
        'mcmultiverse_account_inventory',
        'universe_world_chest',
        'universe_world_property',
        'universe_worlds',
        'universe_account_session',
        'universe_account_property',
        'universe_accounts',
      ]) {
        await db.schema.dropTable(table).execute();
      }
    },
  };
}
