import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { DialectTypes } from '../types.js';

/**
 * MCStory's archive: the lore its agent writes about the network, and the
 * achievements it awards players.
 *
 * A story's id is the UUID MCStory generated for it, so one story keeps one id
 * whether it was written locally first or here. An achievement is held once per
 * player and key, which the primary key enforces rather than a handler.
 */
export function migration008CentralMcstory(t: DialectTypes): Migration {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await db.schema
        .createTable('mcstory_stories')
        .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
        .addColumn('title', 'varchar(200)', (c) => c.notNull())
        .addColumn('content', sql.raw(t.text), (c) => c.notNull())
        // NULL is a story about the server or the world rather than one player.
        .addColumn('player_uuid', 'varchar(36)')
        .addColumn('source', 'varchar(100)', (c) => c.notNull())
        .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
        .execute();

      await db.schema.createIndex('ix_mcstory_stories_created').on('mcstory_stories').column('created_at').execute();
      await db.schema
        .createIndex('ix_mcstory_stories_player')
        .on('mcstory_stories')
        .columns(['player_uuid', 'created_at'])
        .execute();

      await db.schema
        .createTable('mcstory_achievements')
        .addColumn('player_uuid', 'varchar(36)', (c) => c.notNull())
        .addColumn('achievement_key', 'varchar(64)', (c) => c.notNull())
        .addColumn('title', 'varchar(200)', (c) => c.notNull())
        .addColumn('description', sql.raw(t.text), (c) => c.notNull())
        .addColumn('source', 'varchar(100)', (c) => c.notNull())
        .addColumn('awarded_at', sql.raw(t.timestamp), (c) => c.notNull())
        .addPrimaryKeyConstraint('pk_mcstory_achievements', ['player_uuid', 'achievement_key'])
        .execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      for (const table of ['mcstory_achievements', 'mcstory_stories']) {
        await db.schema.dropTable(table).ifExists().execute();
      }
    },
  };
}
