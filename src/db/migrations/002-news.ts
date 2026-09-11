import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { DialectTypes } from '../types.js';

/**
 * News: short posts an operator writes, in Markdown.
 *
 * `hidden_at` is a timestamp rather than a flag, so the row says *when* it was
 * pulled. Nothing here cascades from an account deletion beyond the author
 * reference, because a post that outlives its author is still the site's.
 */
export function migration002News(t: DialectTypes): Migration {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await db.schema
        .createTable('news')
        .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
        .addColumn('author_account_id', sql.raw(t.id), (c) =>
          c.notNull().references('accounts.id'),
        )
        .addColumn('title', 'varchar(200)', (c) => c.notNull())
        .addColumn('summary', 'varchar(300)', (c) => c.notNull())
        // The body is Markdown as typed. It is rendered by the reader, never
        // stored as HTML, so what is kept is what was written.
        .addColumn('body', sql.raw(t.text), (c) => c.notNull())
        .addColumn('hidden_at', sql.raw(t.timestamp))
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      // The list is "newest first, ten at a time", and a ULID sorts by time --
      // so the index that serves the list is the one on the primary key
      // already. This one serves the same page with the hidden ones left out.
      await db.schema
        .createIndex('ix_news_hidden_at')
        .on('news')
        .columns(['hidden_at', 'id'])
        .execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      await db.schema.dropTable('news').ifExists().execute();
    },
  };
}
