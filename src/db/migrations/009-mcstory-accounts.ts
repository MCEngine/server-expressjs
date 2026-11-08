import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { DialectTypes } from '../types.js';

/**
 * Keys MCStory's archive by account instead of by player.
 *
 * An account is an `account_type` plus an `account_uuid`, as MCEconomy keys its
 * wallets: `player` with the player UUID, `clan` with a clan UUID, or any type
 * another plugin defines. Rows written before this migration were all about
 * players, so they become `player` accounts; a story with no player keeps no
 * account.
 *
 * Stories change in place. Achievements are rebuilt, because their primary key
 * gains a column and no supported dialect alters a primary key the same way.
 */
export function migration009McstoryAccounts(t: DialectTypes): Migration {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await dropIndex(db, t, 'ix_mcstory_stories_player');
      await db.schema.alterTable('mcstory_stories').renameColumn('player_uuid', 'account_uuid').execute();
      await db.schema.alterTable('mcstory_stories').addColumn('account_type', 'varchar(50)').execute();
      await sql`update mcstory_stories set account_type = 'player' where account_uuid is not null`.execute(db);
      await db.schema
        .createIndex('ix_mcstory_stories_account')
        .on('mcstory_stories')
        .columns(['account_type', 'account_uuid', 'created_at'])
        .execute();

      await db.schema.alterTable('mcstory_achievements').renameTo('mcstory_achievements_v1').execute();
      await createAchievements(db, t, 'account');
      await sql`
        insert into mcstory_achievements
          (account_type, account_uuid, achievement_key, title, description, source, awarded_at)
        select 'player', player_uuid, achievement_key, title, description, source, awarded_at
        from mcstory_achievements_v1
      `.execute(db);
      await db.schema.dropTable('mcstory_achievements_v1').execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      // Only player accounts have a home in the player-keyed layout.
      await db.schema.alterTable('mcstory_achievements').renameTo('mcstory_achievements_v2').execute();
      await createAchievements(db, t, 'player');
      await sql`
        insert into mcstory_achievements
          (player_uuid, achievement_key, title, description, source, awarded_at)
        select account_uuid, achievement_key, title, description, source, awarded_at
        from mcstory_achievements_v2 where account_type = 'player'
      `.execute(db);
      await db.schema.dropTable('mcstory_achievements_v2').execute();

      await dropIndex(db, t, 'ix_mcstory_stories_account');
      await sql`update mcstory_stories set account_uuid = null where account_type is null or account_type <> 'player'`.execute(db);
      await db.schema.alterTable('mcstory_stories').dropColumn('account_type').execute();
      await db.schema.alterTable('mcstory_stories').renameColumn('account_uuid', 'player_uuid').execute();
      await db.schema
        .createIndex('ix_mcstory_stories_player')
        .on('mcstory_stories')
        .columns(['player_uuid', 'created_at'])
        .execute();
    },
  };
}

/** The achievements table in either layout, under a primary key named for it. */
async function createAchievements(db: Kysely<unknown>, t: DialectTypes, keyedBy: 'account' | 'player'): Promise<void> {
  let table = db.schema.createTable('mcstory_achievements');
  table =
    keyedBy === 'account'
      ? table
          .addColumn('account_type', 'varchar(50)', (c) => c.notNull())
          .addColumn('account_uuid', 'varchar(36)', (c) => c.notNull())
      : table.addColumn('player_uuid', 'varchar(36)', (c) => c.notNull());
  const key = keyedBy === 'account' ? ['account_type', 'account_uuid', 'achievement_key'] : ['player_uuid', 'achievement_key'];
  await table
    .addColumn('achievement_key', 'varchar(64)', (c) => c.notNull())
    .addColumn('title', 'varchar(200)', (c) => c.notNull())
    .addColumn('description', sql.raw(t.text), (c) => c.notNull())
    .addColumn('source', 'varchar(100)', (c) => c.notNull())
    .addColumn('awarded_at', sql.raw(t.timestamp), (c) => c.notNull())
    // Named per layout: on PostgreSQL a constraint name must be unique even while
    // the old table is still present under its temporary name.
    .addPrimaryKeyConstraint(`pk_mcstory_achievements_${keyedBy}`, key as never)
    .execute();
}

/** MySQL and MariaDB name the table an index is dropped from; the others refuse it. */
async function dropIndex(db: Kysely<unknown>, t: DialectTypes, name: string): Promise<void> {
  const drop = db.schema.dropIndex(name);
  await (t.provider === 'mysql' || t.provider === 'mariadb' ? drop.on('mcstory_stories') : drop).execute();
}
