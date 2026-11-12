import type { Kysely } from 'kysely';
import type { Database } from '../../../db/schema.js';

/**
 * Who a story or achievement belongs to: a type such as `player` or `clan`, or
 * any type another plugin defines, and that account's UUID.
 */
export interface AccountKey {
  accountType: string;
  accountUuid: string;
}

export interface Story {
  id: string;
  title: string;
  content: string;
  /** Both null for a story about the world rather than one account. */
  account_type: string | null;
  account_uuid: string | null;
  source: string;
  created_at: string;
}

export interface Achievement {
  account_type: string;
  account_uuid: string;
  achievement_key: string;
  title: string;
  description: string;
  source: string;
  awarded_at: string;
}

export type NewStory = Omit<Story, 'created_at'>;
export type StoryEdit = Omit<Story, 'id' | 'created_at'>;
export type NewAchievement = Omit<Achievement, 'awarded_at'>;

/** The outcome of an award: whether it was new, and the row now held. */
export interface Award {
  awarded: boolean;
  achievement: Achievement;
}

/** Every query behind MCStory's central archive. */
export interface CentralStoryRepository {
  /** Stores a story; undefined when its id is already taken. */
  insertStory(story: NewStory, at: string): Promise<Story | undefined>;
  /** One story by id; undefined when none is archived. */
  story(id: string): Promise<Story | undefined>;
  /** Replaces a story's text, account and source, keeping its id and created_at; undefined when none is archived. */
  updateStory(id: string, edit: StoryEdit): Promise<Story | undefined>;
  /** The newest stories across the network. */
  recentStories(limit: number): Promise<Story[]>;
  /** The newest stories about one account. */
  accountStories(account: AccountKey, limit: number): Promise<Story[]>;
  /** Awards an achievement once; a repeat keeps the first award. */
  award(achievement: NewAchievement, at: string): Promise<Award>;
  /** One account's achievements, oldest first. */
  achievements(account: AccountKey): Promise<Achievement[]>;
}

export function createCentralStoryRepository(db: Kysely<Database>): CentralStoryRepository {
  const stories = () => db.selectFrom('mcstory_stories').selectAll();

  return {
    insertStory: (story, at) =>
      db.transaction().execute(async (trx) => {
        const taken = await trx.selectFrom('mcstory_stories').select('id').where('id', '=', story.id).executeTakeFirst();
        if (taken !== undefined) return undefined;
        const row: Story = { ...story, created_at: at };
        await trx.insertInto('mcstory_stories').values(row).execute();
        return row;
      }),

    story: (id) => stories().where('id', '=', id).executeTakeFirst(),

    updateStory: (id, edit) =>
      db.transaction().execute(async (trx) => {
        const held = await trx.selectFrom('mcstory_stories').selectAll().where('id', '=', id).executeTakeFirst();
        if (held === undefined) return undefined;
        await trx.updateTable('mcstory_stories').set(edit).where('id', '=', id).execute();
        return { ...held, ...edit };
      }),

    recentStories: (limit) => stories().orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute(),

    accountStories: (account, limit) =>
      stories()
        .where('account_type', '=', account.accountType)
        .where('account_uuid', '=', account.accountUuid)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute(),

    award: (achievement, at) =>
      db.transaction().execute(async (trx) => {
        const held = await trx
          .selectFrom('mcstory_achievements')
          .selectAll()
          .where('account_type', '=', achievement.account_type)
          .where('account_uuid', '=', achievement.account_uuid)
          .where('achievement_key', '=', achievement.achievement_key)
          .executeTakeFirst();
        if (held !== undefined) return { awarded: false, achievement: held };
        const row: Achievement = { ...achievement, awarded_at: at };
        await trx.insertInto('mcstory_achievements').values(row).execute();
        return { awarded: true, achievement: row };
      }),

    achievements: (account) =>
      db
        .selectFrom('mcstory_achievements')
        .selectAll()
        .where('account_type', '=', account.accountType)
        .where('account_uuid', '=', account.accountUuid)
        .orderBy('awarded_at')
        .orderBy('achievement_key')
        .execute(),
  };
}
