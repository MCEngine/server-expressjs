import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../../db/schema.js';
import { errors } from '../../../errors.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { uuidParam } from '../http.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSession {
  session_id: string;
  mode: 'CHAT' | 'ASK';
  model_id: string;
  turns: ChatTurn[];
  total_tokens: number;
  updated_at: string;
}

/** Every query behind MCAgentsChat's central sessions. */
export interface CentralChatRepository {
  find(sessionId: string): Promise<ChatSession | undefined>;
  save(session: Omit<ChatSession, 'updated_at'>, at: string): Promise<void>;
  remove(sessionId: string): Promise<void>;
}

const turnSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string() });

export function createCentralChatRepository(db: Kysely<Database>): CentralChatRepository {
  return {
    async find(sessionId) {
      const row = await db
        .selectFrom('mcagentschat_sessions')
        .selectAll()
        .where('session_id', '=', sessionId)
        .executeTakeFirst();
      if (row === undefined) return undefined;
      // Written by this module, so it parses; a row that somehow does not
      // carries no conversation rather than failing the player's chat.
      const turns = z.array(turnSchema).safeParse(JSON.parse(row.turns));
      return {
        session_id: row.session_id,
        mode: row.mode === 'ASK' ? 'ASK' : 'CHAT',
        model_id: row.model_id,
        turns: turns.success ? turns.data : [],
        total_tokens: row.total_tokens,
        updated_at: row.updated_at,
      };
    },

    save: (session, at) =>
      db.transaction().execute(async (trx) => {
        await trx.deleteFrom('mcagentschat_sessions').where('session_id', '=', session.session_id).execute();
        await trx
          .insertInto('mcagentschat_sessions')
          .values({
            session_id: session.session_id,
            mode: session.mode,
            model_id: session.model_id,
            turns: JSON.stringify(session.turns),
            total_tokens: session.total_tokens,
            updated_at: at,
          })
          .execute();
      }),

    async remove(sessionId) {
      await db.deleteFrom('mcagentschat_sessions').where('session_id', '=', sessionId).execute();
    },
  };
}

/**
 * MCAgentsChat's open sessions, under `/api/mcagents-chat`, so a player's
 * conversation follows them from one game server to the next. A session id is
 * the player's UUID, or the server's for the console.
 */
export function createCentralChatRouter(repo: CentralChatRepository, clock: Clock): Router {
  const router = Router();

  router.get('/sessions/:id', async (req, res) => {
    const session = await repo.find(uuidParam(req, 'id'));
    if (session === undefined) throw errors.notFound('session_not_found', 'No open chat session.');
    res.json(session);
  });

  router.put('/sessions/:id', async (req, res) => {
    const body = z
      .object({
        mode: z.enum(['CHAT', 'ASK']),
        model_id: z.string().max(255).default(''),
        turns: z.array(turnSchema).max(2000).default([]),
        total_tokens: z.number().int().min(0).default(0),
      })
      .parse(req.body);
    await repo.save({ session_id: uuidParam(req, 'id'), ...body }, iso(clock.now()));
    res.status(204).end();
  });

  router.delete('/sessions/:id', async (req, res) => {
    await repo.remove(uuidParam(req, 'id'));
    res.status(204).end();
  });

  return router;
}
