import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { serialPrimaryKey, type DialectTypes } from '../types.js';

/**
 * MCEconomy's accounts, currencies, wallets and ledger, and the two plugins
 * built on it: Market's item listings and SlayerRewards' kill and reward logs.
 *
 * Money is a `bigint` because the plugins hold it in a Java `long`. A
 * currency's id is auto-numbered because the plugin parses it as an `int`.
 */
export function migration004CentralEconomy(t: DialectTypes): Migration {
  const uuid = 'varchar(36)';
  const accountType = 'varchar(32)';
  const serial = serialPrimaryKey(t);

  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await db.schema
        .createTable('mceconomy_accounts')
        .addColumn('account_type', accountType, (c) => c.notNull())
        .addColumn('account_uuid', uuid, (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mceconomy_accounts', ['account_type', 'account_uuid'])
        .execute();

      await db.schema
        .createTable('mceconomy_currencies')
        .addColumn('id', sql.raw(t.serial), serial)
        .addColumn('system_code', 'varchar(64)', (c) => c.notNull().unique())
        .addColumn('display_name', 'varchar(255)', (c) => c.notNull())
        .addColumn('is_transferable', sql.raw(t.boolean), (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('mceconomy_wallets')
        .addColumn('account_type', accountType, (c) => c.notNull())
        .addColumn('account_uuid', uuid, (c) => c.notNull())
        .addColumn('currency_id', 'integer', (c) => c.notNull().references('mceconomy_currencies.id'))
        .addColumn('amount', sql.raw(t.bigint), (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mceconomy_wallets', ['account_type', 'account_uuid', 'currency_id'])
        .addForeignKeyConstraint(
          'fk_mceconomy_wallets_account',
          ['account_type', 'account_uuid'],
          'mceconomy_accounts',
          ['account_type', 'account_uuid'],
          (c) => c.onDelete('cascade'),
        )
        .execute();

      await db.schema
        .createTable('mceconomy_logs')
        .addColumn('id', sql.raw(t.serial), serial)
        .addColumn('account_type', accountType, (c) => c.notNull())
        .addColumn('account_uuid', uuid, (c) => c.notNull())
        .addColumn('scope', 'varchar(32)', (c) => c.notNull())
        .addColumn('currency_id', 'integer', (c) => c.notNull())
        .addColumn('amount', sql.raw(t.bigint), (c) => c.notNull())
        .addColumn('transaction_uuid', uuid)
        .addColumn('reference_type', 'varchar(64)')
        .addColumn('reference_id', 'varchar(255)')
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createIndex('ix_mceconomy_logs_account')
        .on('mceconomy_logs')
        .columns(['account_type', 'account_uuid'])
        .execute();

      await db.schema
        .createTable('market_items')
        .addColumn('market_name', 'varchar(255)', (c) => c.notNull())
        .addColumn('item_index', 'integer', (c) => c.notNull())
        .addColumn('metadata', sql.raw(t.text))
        .addColumn('buy_price', sql.raw(t.bigint), (c) => c.notNull())
        .addColumn('sell_price', sql.raw(t.bigint), (c) => c.notNull())
        .addColumn('currency', 'varchar(64)', (c) => c.notNull())
        .addColumn('amount', 'integer', (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_market_items', ['market_name', 'item_index'])
        .execute();

      await db.schema
        .createTable('slayerrewards_kills')
        .addColumn('id', sql.raw(t.serial), serial)
        .addColumn('player_uuid', uuid, (c) => c.notNull())
        .addColumn('mob_type', 'varchar(64)', (c) => c.notNull())
        .addColumn('world', 'varchar(255)')
        .addColumn('x', 'double precision', (c) => c.notNull())
        .addColumn('y', 'double precision', (c) => c.notNull())
        .addColumn('z', 'double precision', (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('slayerrewards_rewards')
        .addColumn('id', sql.raw(t.serial), serial)
        .addColumn('player_uuid', uuid, (c) => c.notNull())
        .addColumn('mob_type', 'varchar(64)', (c) => c.notNull())
        .addColumn('currency', 'varchar(64)', (c) => c.notNull())
        .addColumn('amount', sql.raw(t.bigint), (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      for (const table of ['slayerrewards_kills', 'slayerrewards_rewards']) {
        await db.schema.createIndex(`ix_${table}_player`).on(table).columns(['player_uuid', 'id']).execute();
      }
    },

    async down(db: Kysely<unknown>): Promise<void> {
      for (const table of [
        'slayerrewards_rewards',
        'slayerrewards_kills',
        'market_items',
        'mceconomy_logs',
        'mceconomy_wallets',
        'mceconomy_currencies',
        'mceconomy_accounts',
      ]) {
        await db.schema.dropTable(table).ifExists().execute();
      }
    },
  };
}
