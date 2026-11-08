import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../../errors.js';
import { pathParam } from '../../../http/params.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { uuidParam, uuidSchema } from '../http.js';
import type { AccountKey, CentralStoryRepository } from './repository.js';

const title = z.string().trim().min(1).max(200);
const source = z.string().trim().min(1).max(100);
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) });

/** An achievement key as MCStory writes it: lower-case snake_case. */
const achievementKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_]{0,63}$/, 'Not an achievement key.');

/**
 * An account type: `player`, `clan`, or any type another plugin defines, in
 * lower-case snake_case up to the 50 characters MCEconomy allows.
 */
const accountType = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, 'Not an account type.');

const storySchema = z
  .object({
    id: uuidSchema,
    title,
    content: z.string().trim().min(1).max(20_000),
    account_type: accountType.nullable().default(null),
    account_uuid: uuidSchema.nullable().default(null),
    source,
  })
  .refine((s) => (s.account_type === null) === (s.account_uuid === null), {
    message: 'account_type and account_uuid are given together or not at all.',
    path: ['account_uuid'],
  });

/** Reads the `:accountType/:accountUuid` pair every account route starts with. */
function accountParam(req: Parameters<typeof uuidParam>[0]): AccountKey {
  const type = accountType.safeParse(pathParam(req, 'accountType'));
  if (!type.success) throw errors.badRequest('invalid_account_type', 'accountType is not an account type.');
  return { accountType: type.data, accountUuid: uuidParam(req, 'accountUuid') };
}

const achievementSchema = z.object({
  title,
  description: z.string().trim().min(1).max(2_000),
  source,
});

/**
 * MCStory's central archive, under `/api/mcstory`: the lore its agent writes
 * and the achievements it awards, shared by every game server on the network.
 * Both belong to an account — `player`, `clan`, or a custom type — addressed as
 * `/accounts/:accountType/:accountUuid`.
 */
export function createCentralStoryRouter(repo: CentralStoryRepository, clock: Clock): Router {
  const router = Router();
  const now = () => iso(clock.now());

  router.post('/stories', async (req, res) => {
    const story = await repo.insertStory(storySchema.parse(req.body), now());
    if (story === undefined) throw errors.conflict('story_exists', 'A story with this id is already archived.');
    res.status(201).json({ story });
  });

  router.get('/stories', async (req, res) => {
    const { limit } = limitQuery.parse(req.query);
    res.json({ stories: await repo.recentStories(limit) });
  });

  router.get('/accounts/:accountType/:accountUuid/stories', async (req, res) => {
    const account = accountParam(req);
    const { limit } = limitQuery.parse(req.query);
    res.json({ stories: await repo.accountStories(account, limit) });
  });

  router.put('/accounts/:accountType/:accountUuid/achievements/:key', async (req, res) => {
    const account = accountParam(req);
    const key = achievementKey.safeParse(pathParam(req, 'key'));
    if (!key.success) throw errors.badRequest('invalid_achievement_key', 'key is not an achievement key.');
    const body = achievementSchema.parse(req.body);
    const award = await repo.award(
      { ...body, account_type: account.accountType, account_uuid: account.accountUuid, achievement_key: key.data },
      now(),
    );
    res.status(award.awarded ? 201 : 200).json(award);
  });

  router.get('/accounts/:accountType/:accountUuid/achievements', async (req, res) => {
    res.json({ achievements: await repo.achievements(accountParam(req)) });
  });

  return router;
}
