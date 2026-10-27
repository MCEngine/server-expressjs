import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { serialPrimaryKey, type DialectTypes } from '../types.js';

/**
 * The knowledge store the central brain searches beside MCLog's logs: pages an
 * operator adds -- rules, guides, lore -- each embedded once per model.
 */
export function migration007CentralKnowledge(t: DialectTypes): Migration {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await db.schema
        .createTable('mcagents_knowledge')
        .addColumn('id', sql.raw(t.serial), serialPrimaryKey(t))
        .addColumn('title', 'varchar(255)', (c) => c.notNull())
        .addColumn('content', sql.raw(t.text), (c) => c.notNull())
        .addColumn('source', 'varchar(2048)')
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('mcagents_knowledge_embeddings')
        .addColumn('knowledge_id', 'integer', (c) =>
          c.notNull().references('mcagents_knowledge.id').onDelete('cascade'),
        )
        .addColumn('model_name', 'varchar(255)', (c) => c.notNull())
        .addColumn('embedding', sql.raw(t.text), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcagents_knowledge_embeddings', ['knowledge_id', 'model_name'])
        .execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      await db.schema.dropTable('mcagents_knowledge_embeddings').ifExists().execute();
      await db.schema.dropTable('mcagents_knowledge').ifExists().execute();
    },
  };
}
