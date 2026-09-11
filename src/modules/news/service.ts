import { errors } from '../../errors.js';
import { ulid } from '../../lib/ids.js';
import { iso, type Clock } from '../../lib/clock.js';
import type { NewsRecord, NewsRepository } from './repository.js';

export interface NewsService {
  create(input: {
    authorAccountId: string;
    title: string;
    summary: string;
    body: string;
  }): Promise<NewsRecord>;
  require(id: string): Promise<NewsRecord>;
  list(input: { limit: number; cursor?: string | undefined; includeHidden: boolean }): Promise<
    NewsRecord[]
  >;
  update(
    id: string,
    patch: {
      title?: string | undefined;
      summary?: string | undefined;
      body?: string | undefined;
      hidden?: boolean | undefined;
    },
  ): Promise<NewsRecord>;
  remove(id: string): Promise<void>;
}

export function createNewsService(repo: NewsRepository, clock: Clock): NewsService {
  const now = () => iso(clock.now());

  const require_ = async (id: string): Promise<NewsRecord> => {
    const record = await repo.find(id);
    if (record === undefined) throw errors.notFound('news_not_found', 'No such news item.');
    return record;
  };

  return {
    async create({ authorAccountId, title, summary, body }) {
      const id = ulid();
      await repo.insert({ id, authorAccountId, title, summary, body, at: now() });
      return require_(id);
    },

    require: require_,
    list: (input) => repo.list(input),

    async update(id, patch) {
      await require_(id);
      const at = now();
      await repo.update(
        id,
        {
          ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.summary === undefined ? {} : { summary: patch.summary }),
          ...(patch.body === undefined ? {} : { body: patch.body }),
          // Hiding records *when*, so the row says how long it has been out of
          // view rather than only that it is.
          ...(patch.hidden === undefined ? {} : { hidden_at: patch.hidden ? at : null }),
        },
        at,
      );
      return require_(id);
    },

    async remove(id) {
      await require_(id);
      await repo.remove(id);
    },
  };
}
