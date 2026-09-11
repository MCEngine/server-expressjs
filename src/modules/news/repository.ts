import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';

export interface NewsRecord {
  id: string;
  author_account_id: string;
  title: string;
  summary: string;
  body: string;
  hidden_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewsRepository {
  insert(input: {
    id: string;
    authorAccountId: string;
    title: string;
    summary: string;
    body: string;
    at: string;
  }): Promise<void>;
  find(id: string): Promise<NewsRecord | undefined>;
  /** Newest first. `includeHidden` is for the people who may see one. */
  list(input: {
    limit: number;
    cursor?: string | undefined;
    includeHidden: boolean;
  }): Promise<NewsRecord[]>;
  update(
    id: string,
    patch: { title?: string; summary?: string; body?: string; hidden_at?: string | null },
    at: string,
  ): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createNewsRepository(db: Kysely<Database>): NewsRepository {
  return {
    async insert({ id, authorAccountId, title, summary, body, at }) {
      await db
        .insertInto('news')
        .values({
          id,
          author_account_id: authorAccountId,
          title,
          summary,
          body,
          hidden_at: null,
          created_at: at,
          updated_at: at,
        })
        .execute();
    },

    async find(id) {
      return (await db
        .selectFrom('news')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()) as NewsRecord | undefined;
    },

    async list({ limit, cursor, includeHidden }) {
      let query = db.selectFrom('news').selectAll();
      if (!includeHidden) query = query.where('hidden_at', 'is', null);
      // A ULID sorts by the time it was minted, so "newest first" and "after
      // this one" are the same ordering — no second column and no offset, which
      // is what stops a post published mid-scroll from shifting the page.
      if (cursor !== undefined) query = query.where('id', '<', cursor);
      return (await query
        .orderBy('id', 'desc')
        .limit(limit)
        .execute()) as NewsRecord[];
    },

    async update(id, patch, at) {
      await db
        .updateTable('news')
        .set({ ...patch, updated_at: at })
        .where('id', '=', id)
        .execute();
    },

    async remove(id) {
      await db.deleteFrom('news').where('id', '=', id).execute();
    },
  };
}
