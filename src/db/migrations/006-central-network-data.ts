import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { serialPrimaryKey, type DialectTypes } from '../types.js';

/**
 * The plugins that had no central backend before this server: MCMembership's
 * memberships, MCAgentsChat's open chat sessions, MCPackage's record of what
 * each game server installed, and MCLog's log with its embeddings.
 *
 * An embedding is stored as JSON text rather than a vector type: three of the
 * four engines have none, and the search ranks by cosine similarity in the
 * application, as MCLog's own SQLite backend does.
 */
export function migration006CentralNetworkData(t: DialectTypes): Migration {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await db.schema
        .createTable('mcmembership_memberships')
        .addColumn('account_type', 'varchar(100)', (c) => c.notNull())
        .addColumn('account_uuid', 'varchar(64)', (c) => c.notNull())
        .addColumn('type', 'varchar(150)', (c) => c.notNull())
        // NULL is a membership that never ends.
        .addColumn('ended_at', sql.raw(t.timestamp))
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcmembership_memberships', ['account_type', 'account_uuid', 'type'])
        .execute();

      await db.schema
        .createTable('mcmembership_archived')
        .addColumn('id', sql.raw(t.serial), serialPrimaryKey(t))
        .addColumn('account_type', 'varchar(100)', (c) => c.notNull())
        .addColumn('account_uuid', 'varchar(64)', (c) => c.notNull())
        .addColumn('type', 'varchar(150)', (c) => c.notNull())
        .addColumn('ended_at', sql.raw(t.timestamp))
        .addColumn('archived_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('mcagentschat_sessions')
        .addColumn('session_id', 'varchar(36)', (c) => c.primaryKey())
        .addColumn('mode', 'varchar(8)', (c) => c.notNull())
        .addColumn('model_id', 'varchar(255)', (c) => c.notNull())
        // The conversation so far, as a JSON array of {role, content}.
        .addColumn('turns', sql.raw(t.text), (c) => c.notNull())
        .addColumn('total_tokens', 'integer', (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('mcpackage_packages')
        .addColumn('server_id', 'varchar(36)', (c) => c.notNull())
        .addColumn('platform', 'varchar(32)', (c) => c.notNull())
        .addColumn('project_id', 'varchar(255)', (c) => c.notNull())
        .addColumn('version_id', 'varchar(255)', (c) => c.notNull())
        .addColumn('version', 'varchar(255)', (c) => c.notNull())
        .addColumn('file_name', 'varchar(255)', (c) => c.notNull())
        // Free text as the plugin recorded it -- possibly empty -- so not a
        // timestamp column.
        .addColumn('installed_time', 'varchar(64)', (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcpackage_packages', ['server_id', 'platform', 'project_id'])
        .execute();

      await db.schema
        .createTable('mclog_logs')
        .addColumn('id', sql.raw(t.serial), serialPrimaryKey(t))
        .addColumn('contents', sql.raw(t.text), (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('mclog_embeddings')
        .addColumn('log_id', 'integer', (c) => c.notNull().references('mclog_logs.id').onDelete('cascade'))
        .addColumn('model_name', 'varchar(255)', (c) => c.notNull())
        .addColumn('embedding', sql.raw(t.text), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mclog_embeddings', ['log_id', 'model_name'])
        .execute();

      await db.schema.createIndex('ix_mclog_embeddings_model').on('mclog_embeddings').column('model_name').execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      for (const table of [
        'mclog_embeddings',
        'mclog_logs',
        'mcpackage_packages',
        'mcagentschat_sessions',
        'mcmembership_archived',
        'mcmembership_memberships',
      ]) {
        await db.schema.dropTable(table).ifExists().execute();
      }
    },
  };
}
