import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { serialPrimaryKey, type DialectTypes } from '../types.js';

/**
 * MCAgents' AI platforms, models, per-account keys, active sessions, chat
 * logs and saved prompts.
 *
 * `mcagents_accounts.token` holds a key the plugin has already encrypted with
 * its own `token.secret` before sending it, so this server never sees a usable
 * key from that table -- only the brain behind `ask_global` handles one in the
 * clear, and it keeps none.
 */
export function migration005CentralMcagents(t: DialectTypes): Migration {
  const accountType = 'varchar(32)';
  const accountUuid = 'varchar(64)';
  const modelId = 'varchar(255)';

  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await db.schema
        .createTable('mcagents_platforms')
        .addColumn('id', sql.raw(t.serial), serialPrimaryKey(t))
        .addColumn('display_name', 'varchar(64)', (c) => c.notNull().unique())
        .addColumn('url', 'varchar(2048)', (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('mcagents_models')
        .addColumn('platform_id', 'integer', (c) =>
          c.notNull().references('mcagents_platforms.id').onDelete('cascade'),
        )
        .addColumn('model_id', modelId, (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcagents_models', ['platform_id', 'model_id'])
        .execute();

      await db.schema
        .createTable('mcagents_accounts')
        .addColumn('account_type', accountType, (c) => c.notNull())
        .addColumn('account_uuid', accountUuid, (c) => c.notNull())
        .addColumn('platform_id', 'integer', (c) =>
          c.notNull().references('mcagents_platforms.id').onDelete('cascade'),
        )
        .addColumn('token', sql.raw(t.text), (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcagents_accounts', ['account_type', 'account_uuid', 'platform_id'])
        .execute();

      await db.schema
        .createTable('mcagents_sessions')
        .addColumn('account_type', accountType, (c) => c.notNull())
        .addColumn('account_uuid', accountUuid, (c) => c.notNull())
        .addColumn('platform_id', 'integer', (c) => c.notNull())
        .addColumn('model_id', modelId, (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcagents_sessions', ['account_type', 'account_uuid'])
        .execute();

      await db.schema
        .createTable('mcagents_logs')
        .addColumn('id', sql.raw(t.serial), serialPrimaryKey(t))
        .addColumn('account_type', accountType, (c) => c.notNull())
        .addColumn('account_uuid', accountUuid, (c) => c.notNull())
        .addColumn('platform_id', 'integer', (c) => c.notNull())
        .addColumn('model_id', modelId, (c) => c.notNull())
        .addColumn('chat_history', sql.raw(t.text), (c) => c.notNull())
        .addColumn('token_total_usage', 'integer', (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createIndex('ix_mcagents_logs_account')
        .on('mcagents_logs')
        .columns(['account_type', 'account_uuid', 'id'])
        .execute();

      await db.schema
        .createTable('mcagents_prompts')
        .addColumn('account_type', accountType, (c) => c.notNull())
        .addColumn('account_uuid', accountUuid, (c) => c.notNull())
        .addColumn('prompt_id', 'varchar(128)', (c) => c.notNull())
        .addColumn('prompt', sql.raw(t.text), (c) => c.notNull())
        .addColumn('tools', sql.raw(t.text), (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcagents_prompts', ['account_type', 'account_uuid', 'prompt_id'])
        .execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      for (const table of [
        'mcagents_prompts',
        'mcagents_logs',
        'mcagents_sessions',
        'mcagents_accounts',
        'mcagents_models',
        'mcagents_platforms',
      ]) {
        await db.schema.dropTable(table).ifExists().execute();
      }
    },
  };
}
