import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../../errors.js';
import { pathParam } from '../../../http/params.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { uuidParam, uuidSchema } from '../http.js';
import type { CentralStoryRepository } from './repository.js';

const title = z.string().trim().min(1).max(200);
const source = z.string().trim().min(1).max(100);
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) });

/** An achievement key as MCStory writes it: lower-case snake_case. */
const achievementKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_]{0,63}$/, 'Not an achievement key.');

const storySchema = z.object({
  id: uuidSchema,
  title,
  content: z.string().trim().min(1).max(20_000),
  player_uuid: uuidSchema.nullable().default(null),
  source,
});

const achievementSchema = z.object({
  title,
  description: z.string().trim().min(1).max(2_000),
  source,
});

/**
 * MCStory's central archive, under `/api/mcstory`: the lore its agent writes
 * and the achievements it awards, shared by every game server on the network.
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

  router.get('/players/:playerUuid/stories', async (req, res) => {
    const { limit } = limitQuery.parse(req.query);
    res.json({ stories: await repo.playerStories(uuidParam(req, 'playerUuid'), limit) });
  });

  router.put('/players/:playerUuid/achievements/:key', async (req, res) => {
    const key = achievementKey.safeParse(pathParam(req, 'key'));
    if (!key.success) throw errors.badRequest('invalid_achievement_key', 'key is not an achievement key.');
    const body = achievementSchema.parse(req.body);
    const award = await repo.award(
      { ...body, player_uuid: uuidParam(req, 'playerUuid'), achievement_key: key.data },
      now(),
    );
    res.status(award.awarded ? 201 : 200).json(award);
  });

  router.get('/players/:playerUuid/achievements', async (req, res) => {
    res.json({ achievements: await repo.achievements(uuidParam(req, 'playerUuid')) });
  });

  return router;
}
