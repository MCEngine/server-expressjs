import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../../db/schema.js';
import { insertSerial } from '../../../db/serial.js';
import { errors } from '../../../errors.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { cosine, parseVector, topK } from '../../../lib/vectors.js';
import { intParam } from '../http.js';

export interface LogEntry {
  id: number;
  contents: string;
  created_at: string;
}

export interface LogMatch extends LogEntry {
  similarity: number;
}

/**
 * Every query behind MCLog's central store. It is also the network's searchable
 * memory: the brain behind `ask_global` searches it the same way.
 */
export interface CentralLogRepository {
  insert(contents: string, at: string): Promise<LogEntry>;
  /** False when the log does not exist. */
  embed(logId: number, modelName: string, embedding: readonly number[]): Promise<boolean>;
  recent(limit: number): Promise<LogEntry[]>;
  /** Ranks every log embedded with `modelName` by cosine similarity to `query`. */
  search(modelName: string, query: readonly number[], limit: number): Promise<LogMatch[]>;
  count(): Promise<number>;
}

export function createCentralLogRepository(db: Kysely<Database>): CentralLogRepository {
  return {
    insert: (contents, at) =>
      db.transaction().execute(async (trx) => {
        const id = await insertSerial(trx, 'mclog_logs', { contents, created_at: at });
        return { id, contents, created_at: at };
      }),

    embed: (logId, modelName, embedding) =>
      db.transaction().execute(async (trx) => {
        const log = await trx.selectFrom('mclog_logs').select('id').where('id', '=', logId).executeTakeFirst();
        if (log === undefined) return false;
        await trx
          .deleteFrom('mclog_embeddings')
          .where('log_id', '=', logId)
          .where('model_name', '=', modelName)
          .execute();
        await trx
          .insertInto('mclog_embeddings')
          .values({ log_id: logId, model_name: modelName, embedding: JSON.stringify(embedding) })
          .execute();
        return true;
      }),

    recent: (limit) => db.selectFrom('mclog_logs').selectAll().orderBy('id', 'desc').limit(limit).execute(),

    async search(modelName, query, limit) {
      const rows = await db
        .selectFrom('mclog_embeddings')
        .innerJoin('mclog_logs', 'mclog_logs.id', 'mclog_embeddings.log_id')
        .select(['mclog_logs.id', 'mclog_logs.contents', 'mclog_logs.created_at', 'mclog_embeddings.embedding'])
        .where('mclog_embeddings.model_name', '=', modelName)
        .execute();
      return topK(rows, (row) => cosine(query, parseVector(row.embedding)), limit).map(({ item, score }) => ({
        id: item.id,
        contents: item.contents,
        created_at: item.created_at,
        similarity: score,
      }));
    },

    async count() {
      const row = await db
        .selectFrom('mclog_logs')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },
  };
}

const modelName = z.string().trim().toLowerCase().pipe(z.string().min(1).max(255));
const embedding = z.array(z.number().finite()).min(1).max(8192);

/**
 * MCLog's central store, under `/api/mclog`: one network-wide log, embedded
 * for search, so a question asked on any server finds what happened on all
 * of them.
 */
export function createCentralLogRouter(repo: CentralLogRepository, clock: Clock): Router {
  const router = Router();

  router.post('/logs', async (req, res) => {
    const { contents } = z.object({ contents: z.string().min(1).max(100_000) }).parse(req.body);
    res.status(201).json(await repo.insert(contents, iso(clock.now())));
  });

  router.get('/logs', async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(20) }).parse(req.query);
    res.json({ logs: await repo.recent(limit) });
  });

  router.get('/logs/count', async (_req, res) => {
    res.json({ count: await repo.count() });
  });

  router.put('/logs/:id/embeddings', async (req, res) => {
    const body = z.object({ model_name: modelName, embedding }).parse(req.body);
    if (!(await repo.embed(intParam(req, 'id'), body.model_name, body.embedding))) {
      throw errors.notFound('log_not_found', 'No such log.');
    }
    res.status(204).end();
  });

  router.post('/logs/search', async (req, res) => {
    const body = z
      .object({ model_name: modelName, embedding, limit: z.number().int().min(1).max(100).default(10) })
      .parse(req.body);
    res.json({ matches: await repo.search(body.model_name, body.embedding, body.limit) });
  });

  return router;
}
