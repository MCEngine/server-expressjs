import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../../errors.js';
import { pathParam } from '../../../http/params.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { intParam, uuidParam, uuidSchema } from '../http.js';
import { STAT_KEYS, type CentralIdentityRepository, type SlotKind, type StatKey } from './repository.js';

const ALIAS_MAX = 32;
const code = z.string().trim().min(1).max(64);
const nullableText = z.string().nullable();

const statsSchema = z.object(
  Object.fromEntries(STAT_KEYS.map((key) => [key, z.number().int()])) as Record<StatKey, z.ZodNumber>,
);

const createIdentitySchema = z.object({
  uuid: uuidSchema,
  professionCode: code,
  properties: z.object({
    level: z.number().int(),
    exp: z.number().int(),
    statPoints: z.number().int(),
    headText: nullableText.optional().default(null),
  }),
  stats: statsSchema,
});

const propertiesSchema = z.object({
  level: z.number().int(),
  exp: z.number().int(),
  statPoints: z.number().int(),
  headText: nullableText.optional().default(null),
  inventoryContents: nullableText.optional().default(null),
  enderchestContents: nullableText.optional().default(null),
});

const catalogueSchema = z.object({
  systemCode: code,
  displayName: z.string().min(1).max(255),
  item: nullableText.optional().default(null),
});

/** Which body field each slot-based add-on sends its value in. */
const SLOT_FIELD: Record<SlotKind, string> = { skills: 'skillItem', runes: 'runeCode' };

/**
 * The MCIdentity family's central API, at the paths its released clients
 * already call: `/v1/professions`, `/v1/identities/...`, `/v1/players/...`,
 * `/v1/logs`, `/v1/skills`, `/v1/runes`, and each identity's skills, runes
 * and cosmetics.
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

  router.post('/identities', async (req, res) => {
    const body = createIdentitySchema.parse(req.body);
    if (!(await repo.professionExists(body.professionCode))) {
      throw errors.unprocessable('unknown_profession', `No profession ${body.professionCode} is registered.`);
    }
    const created = await repo.createIdentity({
      uuid: body.uuid,
      professionCode: body.professionCode,
      properties: body.properties,
      stats: body.stats,
      at: now(),
    });
    if (!created) throw errors.conflict('identity_exists', 'An identity with this UUID already exists.');
    res.status(201).json({ uuid: body.uuid, professionCode: body.professionCode });
  });

  // Before `/identities/:uuid`, so an alias lookup is never read as a UUID.
  router.get('/identities/alias/:alias', async (req, res) => {
    const alias = pathParam(req, 'alias');
    const uuid = alias.length > ALIAS_MAX ? undefined : await repo.byAlias(alias.toLowerCase());
    if (uuid === undefined) throw errors.notFound('alias_not_found', 'No identity has this alias.');
    res.json({ uuid });
  });

  router.get('/identities/:uuid', async (req, res) => {
    const uuid = uuidParam(req, 'uuid');
    const professionCode = await repo.professionOf(uuid);
    if (professionCode === undefined) throw errors.notFound('identity_not_found', 'No such identity.');
    res.json({ uuid, professionCode });
  });

  router.get('/identities/:uuid/properties', async (req, res) => {
    const properties = await repo.properties(uuidParam(req, 'uuid'));
    if (properties === undefined) throw errors.notFound('identity_not_found', 'No such identity.');
    res.json(properties);
  });

  router.put('/identities/:uuid/properties', async (req, res) => {
    const body = propertiesSchema.parse(req.body);
    if (!(await repo.updateProperties(uuidParam(req, 'uuid'), body, now()))) {
      throw errors.notFound('identity_not_found', 'No such identity.');
    }
    res.status(204).end();
  });

  router.put('/identities/:uuid/alias', async (req, res) => {
    const { alias } = z.object({ alias: z.string().min(1).max(ALIAS_MAX).nullable() }).parse(req.body);
    const outcome = await repo.setAlias(uuidParam(req, 'uuid'), alias, now());
    if (outcome === 'missing') throw errors.notFound('identity_not_found', 'No such identity.');
    if (outcome === 'taken') throw errors.conflict('alias_taken', 'Another identity already has this alias.');
    res.status(204).end();
  });

  router.get('/identities/:uuid/stats', async (req, res) => {
    const stats = await repo.stats(uuidParam(req, 'uuid'));
    if (stats === undefined) throw errors.notFound('identity_not_found', 'No such identity.');
    res.json(stats);
  });

  router.put('/identities/:uuid/stats', async (req, res) => {
    const stats = statsSchema.parse(req.body);
    if (!(await repo.updateStats(uuidParam(req, 'uuid'), stats, now()))) {
      throw errors.notFound('identity_not_found', 'No such identity.');
    }
    res.status(204).end();
  });

  router.get('/identities/:uuid/stats/:key', async (req, res) => {
    const key = statKey(pathParam(req, 'key'));
    const stats = await repo.stats(uuidParam(req, 'uuid'));
    if (stats === undefined) throw errors.notFound('identity_not_found', 'No such identity.');
    res.json({ value: stats[key] });
  });

  router.post('/identities/:uuid/stats/:key/add', async (req, res) => {
    const key = statKey(pathParam(req, 'key'));
    const { amount } = z.object({ amount: z.number().int() }).parse(req.body);
    if (!(await repo.addStat(uuidParam(req, 'uuid'), key, amount, now()))) {
      throw errors.notFound('identity_not_found', 'No such identity.');
    }
    res.status(204).end();
  });

  router.get('/players/:uuid/session', async (req, res) => {
    const session = await repo.session(uuidParam(req, 'uuid'));
    if (session === undefined) throw errors.notFound('session_not_found', 'The player wears no identity.');
    res.json(session);
  });

  router.put('/players/:uuid/session', async (req, res) => {
    const player = uuidParam(req, 'uuid');
    const body = z
      .object({ identityUuid: uuidSchema.nullable(), contentKey: nullableText.optional().default(null) })
      .parse(req.body);
    // A null identity takes the player out of their identity, which is how
    // the plugin's own backends read it.
    if (body.identityUuid === null) {
      await repo.clearSession(player);
    } else if (!(await repo.setSession(player, body.identityUuid, body.contentKey, now()))) {
      throw errors.notFound('identity_not_found', 'No such identity.');
    }
    res.status(204).end();
  });

  router.patch('/players/:uuid/session/content-key', async (req, res) => {
    const { contentKey } = z.object({ contentKey: nullableText }).parse(req.body);
    await repo.setContentKey(uuidParam(req, 'uuid'), contentKey);
    res.status(204).end();
  });

  router.get('/players/:uuid/base-slots', async (req, res) => {
    res.json({ slots: await repo.baseSlots(uuidParam(req, 'uuid')) });
  });

  router.post('/players/:uuid/base-slots/add', async (req, res) => {
    const { amount } = z.object({ amount: z.number().int() }).parse(req.body);
    res.json({ slots: await repo.addBaseSlots(uuidParam(req, 'uuid'), amount, now()) });
  });

  router.post('/logs', async (req, res) => {
    const body = z
      .object({ playerUuid: uuidSchema, identityUuid: uuidSchema, actionType: z.string().min(1).max(50) })
      .parse(req.body);
    await repo.log(body.playerUuid, body.identityUuid, body.actionType, now());
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
