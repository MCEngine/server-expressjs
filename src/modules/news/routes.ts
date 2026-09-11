import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../errors.js';
import { pathParam } from '../../http/params.js';
import { requireSession, actorOf } from '../auth/middleware.js';
import { publicAccount } from '../identity/routes.js';
import type { IdentityService } from '../identity/service.js';
import type { AuditService } from '../audit/index.js';
import type { NewsRecord } from './repository.js';
import type { NewsService } from './service.js';

const writeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(300),
  /** Markdown. Stored as typed, rendered by the reader. */
  body: z.string().min(1).max(100_000),
});

const patchSchema = writeSchema.partial().extend({ hidden: z.boolean().optional() });

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().optional(),
});

export function createNewsRouter(
  news: NewsService,
  identity: IdentityService,
  audit: AuditService,
  /** Handles allowed to write news. Empty means nobody, which is the default. */
  authorHandles: readonly string[],
): Router {
  const router = Router();

  const publicNews = (record: NewsRecord, author?: unknown): Record<string, unknown> => ({
    id: record.id,
    title: record.title,
    summary: record.summary,
    body: record.body,
    created_at: record.created_at,
    updated_at: record.updated_at,
    hidden: record.hidden_at !== null,
    ...(record.hidden_at === null ? {} : { hidden_at: record.hidden_at }),
    ...(author === undefined ? {} : { author }),
  });

  const authorOf = async (record: NewsRecord): Promise<unknown> =>
    publicAccount(await identity.requireAccount(record.author_account_id));

  /**
   * May this caller write news at all?
   *
   * There is no staff role in this service, so the allowlist is the only thing
   * between "signed in" and "publishes on the front page". Empty by default:
   * a deployment nobody has configured has no news authors rather than every
   * account being one.
   */
  const requireAuthor = async (accountId: string): Promise<void> => {
    const account = await identity.requireAccount(accountId);
    if (!authorHandles.includes(account.handle)) {
      throw errors.forbidden(
        'not_a_news_author',
        'This account may not write news. Add its handle to NEWS_AUTHORS.',
      );
    }
  };

  /** The author of the piece, which is who may change it. */
  const requireOwn = async (record: NewsRecord, accountId: string): Promise<void> => {
    if (record.author_account_id !== accountId) {
      throw errors.forbidden('not_the_author', 'Only the author of a news item may change it.');
    }
  };

  /** Whether the caller may see a hidden item — the author, or any author. */
  const maySeeHidden = async (record: NewsRecord, accountId: string | undefined): Promise<boolean> => {
    if (accountId === undefined) return false;
    if (record.author_account_id === accountId) return true;
    const account = await identity.requireAccount(accountId);
    return authorHandles.includes(account.handle);
  };

  router.get('/news', async (req, res) => {
    const { limit, cursor } = pageSchema.parse(req.query);
    const actor = req.actor?.kind === 'session' ? req.actor.accountId : undefined;
    const includeHidden =
      actor !== undefined &&
      authorHandles.includes((await identity.requireAccount(actor)).handle);

    const rows = await news.list({ limit, cursor, includeHidden });
    res.json({
      data: await Promise.all(rows.map(async (r) => publicNews(r, await authorOf(r)))),
      // Only a full page can have another behind it, which is what stops the
      // reader asking for an eleventh page that was never there.
      next_cursor: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
    });
  });

  router.get('/news/:id', async (req, res) => {
    const record = await news.require(pathParam(req, 'id'));
    const actor = req.actor?.kind === 'session' ? req.actor.accountId : undefined;

    // 404 rather than 403 for a hidden item: a reader who may not see it should
    // not learn it exists by being refused.
    if (record.hidden_at !== null && !(await maySeeHidden(record, actor))) {
      throw errors.notFound('news_not_found', 'No such news item.');
    }
    res.json(publicNews(record, await authorOf(record)));
  });

  router.post('/news', requireSession, async (req, res) => {
    const actor = actorOf(req);
    await requireAuthor(actor.accountId);

    const body = writeSchema.parse(req.body);
    const record = await news.create({ authorAccountId: actor.accountId, ...body });
    await audit.record({
      actor,
      subjectType: 'news',
      subjectId: record.id,
      action: 'news.created',
      metadata: { title: record.title },
      ip: req.ip,
    });
    res.status(201).json(publicNews(record, await authorOf(record)));
  });

  router.patch('/news/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const existing = await news.require(pathParam(req, 'id'));
    await requireOwn(existing, actor.accountId);

    const patch = patchSchema.parse(req.body);
    const record = await news.update(existing.id, patch);
    await audit.record({
      actor,
      subjectType: 'news',
      subjectId: record.id,
      action: patch.hidden === undefined ? 'news.edited' : patch.hidden ? 'news.hidden' : 'news.shown',
      metadata: { title: record.title },
      ip: req.ip,
    });
    res.json(publicNews(record, await authorOf(record)));
  });

  router.delete('/news/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const existing = await news.require(pathParam(req, 'id'));
    await requireOwn(existing, actor.accountId);

    await news.remove(existing.id);
    await audit.record({
      actor,
      subjectType: 'news',
      subjectId: existing.id,
      action: 'news.deleted',
      metadata: { title: existing.title },
      ip: req.ip,
    });
    res.status(204).end();
  });

  return router;
}
