import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../../errors.js';
import { pathParam } from '../../../http/params.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { intParam, uuidParam, uuidSchema } from '../http.js';
import { STAT_KEYS, type CentralIdentityRepository, type SlotKind, type StatKey } from './repository.js';

const code = z.string().trim().min(1).max(64);
const nullableText = z.string().nullable();

const statsSchema = z.object({
  statPoints: z.number().int(),
  ...(Object.fromEntries(STAT_KEYS.map((key) => [key, z.number().int()])) as Record<StatKey, z.ZodNumber>),
});

const progressSchema = z.object({ level: z.number().int(), exp: z.number().int() });

const catalogueSchema = z.object({
  systemCode: code,
  displayName: z.string().min(1).max(255),
  item: nullableText.optional().default(null),
});

/** Which body field each slot-based add-on sends its value in. */
const SLOT_FIELD: Record<SlotKind, string> = { skills: 'skillItem', runes: 'runeCode' };

/**
 * The MCIdentity family's central API, at the paths its released clients
 * call: `/v1/professions`, `/v1/players/...`, `/v1/profession-logs`,
 * `/v1/skills`, `/v1/runes`, and each player's skills, runes and cosmetics
 * under `/v1/identities/:uuid/...`, where the UUID is the player's own.
 *
 * Mounted at `/v1`. Reads answer 404 when there is nothing, which the client
 * turns into its neutral value; writes answer 204.
 */
export function createCentralIdentityRouter(repo: CentralIdentityRepository, clock: Clock): Router {
  const router = Router();
  const now = () => iso(clock.now());

  const statKey = (raw: string): StatKey => {
    if (!(STAT_KEYS as readonly string[]).includes(raw)) {
      throw errors.badRequest('unknown_stat', `No stat named ${raw}.`);
    }
    return raw as StatKey;
  };

  router.post('/professions', async (req, res) => {
    const body = catalogueSchema.omit({ item: true }).parse(req.body);
    await repo.addProfession(body.systemCode, body.displayName, now());
    res.status(204).end();
  });

  router.get('/professions', async (_req, res) => {
    res.json(await repo.professions());
  });

  const unknownPlayer = () => errors.notFound('player_not_found', 'No such player.');

  // Creates only when absent: the plugin calls it on every join.
  router.post('/players', async (req, res) => {
    const body = z.object({ playerUuid: uuidSchema, stats: statsSchema }).parse(req.body);
    const created = await repo.createPlayer(body.playerUuid, body.stats, now());
    res.status(created ? 201 : 200).json({ playerUuid: body.playerUuid });
  });

  router.get('/players/:uuid/stats', async (req, res) => {
    const stats = await repo.stats(uuidParam(req, 'uuid'));
    if (stats === undefined) throw unknownPlayer();
    res.json(stats);
  });

  router.put('/players/:uuid/stats', async (req, res) => {
    const stats = statsSchema.parse(req.body);
    if (!(await repo.updateStats(uuidParam(req, 'uuid'), stats, now()))) throw unknownPlayer();
    res.status(204).end();
  });

  router.get('/players/:uuid/stats/:key', async (req, res) => {
    const key = statKey(pathParam(req, 'key'));
    const stats = await repo.stats(uuidParam(req, 'uuid'));
    if (stats === undefined) throw unknownPlayer();
    res.json({ value: stats[key] });
  });

  router.post('/players/:uuid/stats/:key/add', async (req, res) => {
    const key = statKey(pathParam(req, 'key'));
    const { amount } = z.object({ amount: z.number().int() }).parse(req.body);
    if (!(await repo.addStat(uuidParam(req, 'uuid'), key, amount, now()))) throw unknownPlayer();
    res.status(204).end();
  });

  router.get('/players/:uuid/profession', async (req, res) => {
    const professionCode = await repo.activeProfession(uuidParam(req, 'uuid'));
    if (professionCode === undefined) {
      throw errors.notFound('profession_not_worn', 'The player wears no profession.');
    }
    res.json({ professionCode });
  });

  router.put('/players/:uuid/profession', async (req, res) => {
    const player = uuidParam(req, 'uuid');
    const { professionCode } = z.object({ professionCode: code }).parse(req.body);
    if (!(await repo.professionExists(professionCode))) {
      throw errors.unprocessable('unknown_profession', `No profession ${professionCode} is registered.`);
    }
    await repo.setActiveProfession(player, professionCode, now());
    res.status(204).end();
  });

  router.get('/players/:uuid/professions/:code/progress', async (req, res) => {
    const progress = await repo.progress(uuidParam(req, 'uuid'), code.parse(pathParam(req, 'code')));
    if (progress === undefined) {
      throw errors.notFound('progress_not_found', 'The player never wore this profession.');
    }
    res.json(progress);
  });

  router.put('/players/:uuid/professions/:code/progress', async (req, res) => {
    const player = uuidParam(req, 'uuid');
    const professionCode = code.parse(pathParam(req, 'code'));
    await repo.saveProgress(player, professionCode, progressSchema.parse(req.body), now());
    res.status(204).end();
  });

  router.post('/profession-logs', async (req, res) => {
    const body = z
      .object({ playerUuid: uuidSchema, professionCode: code, actionType: z.string().min(1).max(50) })
      .parse(req.body);
    await repo.log(body.playerUuid, body.professionCode, body.actionType, now());
    res.status(204).end();
  });

  for (const kind of ['skills', 'runes'] as const) {
    const field = SLOT_FIELD[kind];

    router.post(`/${kind}`, async (req, res) => {
      await repo.addCatalogue(kind, catalogueSchema.parse(req.body), now());
      res.status(204).end();
    });

    router.get(`/${kind}`, async (_req, res) => {
      res.json(await repo.catalogue(kind));
    });

    router.get(`/identities/:uuid/${kind}`, async (req, res) => {
      res.json(await repo.equipped(kind, uuidParam(req, 'uuid')));
    });

    router.put(`/identities/:uuid/${kind}/:slot`, async (req, res) => {
      const body = z.object({ [field]: z.string().max(255).nullable() }).parse(req.body);
      const value = body[field] as string | null;
      await repo.equip(kind, uuidParam(req, 'uuid'), intParam(req, 'slot'), value, now());
      res.status(204).end();
    });
  }

  router.get('/identities/:uuid/cosmetics', async (req, res) => {
    const cosmetics = await repo.cosmetics(uuidParam(req, 'uuid'));
    res.json(cosmetics ?? { skin: null, aura: null });
  });

  // Partial: the plugin saves the skin and the aura in separate calls, each
  // carrying only its own field. Present and null clears; absent keeps.
  router.put('/identities/:uuid/cosmetics', async (req, res) => {
    const patch = z
      .object({ skin: nullableText.optional(), aura: nullableText.optional() })
      .parse(req.body);
    await repo.saveCosmetics(uuidParam(req, 'uuid'), patch, now());
    res.status(204).end();
  });

  return router;
}
