import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../../errors.js';
import { pathParam } from '../../../http/params.js';
import { iso, type Clock } from '../../../lib/clock.js';
import type { AccountKey, CentralMcagentsRepository } from './repository.js';

const accountKey = {
  account_type: z.string().trim().min(1).max(32),
  account_uuid: z.string().trim().min(1).max(64),
};
const platformId = z.coerce.number().int().positive();
const modelId = z.string().trim().min(1).max(255);
const promptId = z.string().trim().min(1).max(128);

const keyOf = (q: { account_type: string; account_uuid: string }): AccountKey => ({
  accountType: q.account_type,
  accountUuid: q.account_uuid,
});

/**
 * MCAgents' central backend, at the paths its released client calls under
 * `/api/mcagents`. Platforms, models, keys, sessions, logs and prompts are
 * stored as the plugin's own SQL backends store them.
 *
 * The client reads a 404 as "none" and anything else at 400 and above as a
 * failure, so a lookup that finds nothing is always a 404.
 */
export function createCentralMcagentsRouter(repo: CentralMcagentsRepository, clock: Clock): Router {
  const router = Router();
  const now = () => iso(clock.now());

  const requirePlatform = async (id: number) => {
    if ((await repo.platform(id)) === undefined) throw errors.notFound('platform_not_found', `No platform ${id}.`);
  };

  router.post('/platforms', async (req, res) => {
    const body = z
      .object({ display_name: z.string().trim().min(1).max(64), url: z.string().url().max(2048) })
      .parse(req.body);
    res.json(await repo.ensurePlatform(body.display_name, body.url, now()));
  });

  router.get('/platforms', async (_req, res) => {
    res.json(await repo.platforms());
  });

  router.get('/platforms/:id', async (req, res) => {
    const platform = await repo.platform(platformId.parse(pathParam(req, 'id')));
    if (platform === undefined) throw errors.notFound('platform_not_found', 'No such platform.');
    res.json(platform);
  });

  router.post('/models', async (req, res) => {
    const body = z.object({ platform_id: platformId, model_id: modelId }).parse(req.body);
    await requirePlatform(body.platform_id);
    res.json(await repo.ensureModel(body.platform_id, body.model_id, now()));
  });

  router.get('/models', async (req, res) => {
    const query = z.object({ platform_id: platformId }).parse(req.query);
    res.json(await repo.models(query.platform_id));
  });

  router.get('/models/find', async (req, res) => {
    const query = z.object({ platform_id: platformId, model_id: modelId }).parse(req.query);
    const model = await repo.model(query.platform_id, query.model_id);
    if (model === undefined) throw errors.notFound('model_not_found', 'No such model.');
    res.json(model);
  });

  router.post('/accounts', async (req, res) => {
    const body = z
      .object({ ...accountKey, platform_id: platformId, token: z.string().min(1).max(8192) })
      .parse(req.body);
    await requirePlatform(body.platform_id);
    res.json(await repo.saveAccount(keyOf(body), body.platform_id, body.token, now()));
  });

  router.get('/accounts', async (req, res) => {
    const query = z.object({ ...accountKey, platform_id: platformId }).parse(req.query);
    const account = await repo.account(keyOf(query), query.platform_id);
    if (account === undefined) throw errors.notFound('account_not_found', 'No key is stored for this account.');
    res.json(account);
  });

  router.delete('/accounts', async (req, res) => {
    await repo.deleteAccounts(keyOf(z.object(accountKey).parse(req.query)));
    res.status(204).end();
  });

  router.post('/sessions', async (req, res) => {
    const body = z.object({ ...accountKey, platform_id: platformId, model_id: modelId }).parse(req.body);
    await requirePlatform(body.platform_id);
    await repo.setSession(keyOf(body), body.platform_id, body.model_id, now());
    res.status(204).end();
  });

  router.get('/sessions', async (req, res) => {
    const session = await repo.session(keyOf(z.object(accountKey).parse(req.query)));
    if (session === undefined) throw errors.notFound('session_not_found', 'No model is selected for this account.');
    res.json(session);
  });

  router.post('/logs', async (req, res) => {
    const body = z
      .object({
        ...accountKey,
        platform_id: platformId,
        model_id: modelId,
        chat_history: z.string(),
        token_total_usage: z.number().int().min(0),
      })
      .parse(req.body);
    res.status(201).json(
      await repo.insertLog(
        keyOf(body),
        {
          platformId: body.platform_id,
          modelId: body.model_id,
          chatHistory: body.chat_history,
          tokenTotalUsage: body.token_total_usage,
        },
        now(),
      ),
    );
  });

  router.get('/logs', async (req, res) => {
    const query = z
      .object({ ...accountKey, limit: z.coerce.number().int().min(1).max(500).default(20) })
      .parse(req.query);
    res.json(await repo.logs(keyOf(query), query.limit));
  });

  router.post('/prompts', async (req, res) => {
    const body = z
      .object({ ...accountKey, prompt_id: promptId, prompt: z.string().min(1), tools: z.string().default('') })
      .parse(req.body);
    res.json(await repo.ensurePrompt(keyOf(body), body.prompt_id, body.prompt, body.tools, now()));
  });

  router.get('/prompts/find', async (req, res) => {
    const query = z.object({ ...accountKey, prompt_id: promptId }).parse(req.query);
    const prompt = await repo.prompt(keyOf(query), query.prompt_id);
    if (prompt === undefined) throw errors.notFound('prompt_not_found', 'No such saved prompt.');
    res.json(prompt);
  });

  router.get('/prompts', async (req, res) => {
    res.json(await repo.prompts(keyOf(z.object(accountKey).parse(req.query))));
  });

  router.put('/prompts/tools', async (req, res) => {
    const body = z.object({ ...accountKey, prompt_id: promptId, tools: z.string().default('') }).parse(req.body);
    const prompt = await repo.setPromptTools(keyOf(body), body.prompt_id, body.tools, now());
    if (prompt === undefined) throw errors.notFound('prompt_not_found', 'No such saved prompt.');
    res.json(prompt);
  });

  router.delete('/prompts', async (req, res) => {
    const query = z.object({ ...accountKey, prompt_id: promptId }).parse(req.query);
    await repo.deletePrompt(keyOf(query), query.prompt_id);
    res.status(204).end();
  });

  return router;
}
