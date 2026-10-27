import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../../errors.js';
import type { KnowledgeRepository } from './knowledge.js';
import type { BrainService } from './service.js';
import { intParam } from '../http.js';

/** The caller's own key for the AI API. Spent on this request, never stored. */
const token = z.string().trim().min(1).max(512);
const apiUrl = z.string().url().max(2048).optional();

/**
 * The central brain, beside MCAgents' data under `/api/mcagents`:
 * `ask_global` for a question, and the knowledge pages it searches.
 */
export function createBrainRouter(brain: BrainService, knowledge: KnowledgeRepository): Router {
  const router = Router();

  router.post('/ask_global', async (req, res) => {
    const body = z
      .object({
        question: z.string().trim().min(1).max(20_000),
        token,
        model: z.string().trim().min(1).max(255).optional(),
        api_url: apiUrl,
      })
      .parse(req.body);
    res.json(await brain.ask({ question: body.question, token: body.token, model: body.model, apiUrl: body.api_url }));
  });

  router.post('/knowledge', async (req, res) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(255),
        content: z.string().min(1).max(100_000),
        source: z.string().max(2048).nullish(),
        token,
        api_url: apiUrl,
      })
      .parse(req.body);
    res.status(201).json(
      await brain.addKnowledge({
        title: body.title,
        content: body.content,
        source: body.source ?? null,
        token: body.token,
        apiUrl: body.api_url,
      }),
    );
  });

  router.get('/knowledge', async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }).parse(req.query);
    res.json({ knowledge: await knowledge.list(limit) });
  });

  router.delete('/knowledge/:id', async (req, res) => {
    if (!(await knowledge.remove(intParam(req, 'id')))) {
      throw errors.notFound('knowledge_not_found', 'No such knowledge page.');
    }
    res.status(204).end();
  });

  return router;
}
