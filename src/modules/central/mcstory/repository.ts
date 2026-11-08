import type { Kysely } from 'kysely';
import type { Database } from '../../../db/schema.js';

export interface Story {
  id: string;
  title: string;
  content: string;
  player_uuid: string | null;
  source: string;
  created_at: string;
}

export interface Achievement {
  player_uuid: string;
  achievement_key: string;
  title: string;
  description: string;
  source: string;
  awarded_at: string;
}

export type NewStory = Omit<Story, 'created_at'>;
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
  /** The newest stories across the network. */
  recentStories(limit: number): Promise<Story[]>;
  /** The newest stories about one player. */
  playerStories(playerUuid: string, limit: number): Promise<Story[]>;
  /** Awards an achievement once; a repeat keeps the first award. */
  award(achievement: NewAchievement, at: string): Promise<Award>;
  /** One player's achievements, oldest first. */
  achievements(playerUuid: string): Promise<Achievement[]>;
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

    recentStories: (limit) => stories().orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute(),

    playerStories: (playerUuid, limit) =>
      stories()
        .where('player_uuid', '=', playerUuid)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute(),

    award: (achievement, at) =>
      db.transaction().execute(async (trx) => {
        const held = await trx
          .selectFrom('mcstory_achievements')
          .selectAll()
          .where('player_uuid', '=', achievement.player_uuid)
          .where('achievement_key', '=', achievement.achievement_key)
          .executeTakeFirst();
        if (held !== undefined) return { awarded: false, achievement: held };
        const row: Achievement = { ...achievement, awarded_at: at };
        await trx.insertInto('mcstory_achievements').values(row).execute();
        return { awarded: true, achievement: row };
      }),

    achievements: (playerUuid) =>
      db
        .selectFrom('mcstory_achievements')
        .selectAll()
        .where('player_uuid', '=', playerUuid)
        .orderBy('awarded_at')
        .orderBy('achievement_key')
        .execute(),
  };
}
