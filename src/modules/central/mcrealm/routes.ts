import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { errors } from '../../../errors.js';
import { pathParam } from '../../../http/params.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { uuidParam, uuidSchema } from '../http.js';
import {
  accountTypeSchema,
  createUniverseRouter,
  mountPageRoutes,
  type PageStore,
  type UniverseRepository,
} from '../universe/index.js';
import type { CentralRealmRepository, RealmRefusal } from './repository.js';

const systemCode = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, 'Not a system code.');
const realmName = z.string().regex(/^[a-z0-9][a-z0-9_\-]{0,63}$/, 'Not a realm name.');
const displayName = z.string().trim().min(1).max(64);

const realmTypeBody = z.object({ display_name: displayName });

const newRealmSchema = z
  .object({
    id: uuidSchema.optional(),
    realm_type: systemCode,
    realm_name: realmName,
    display_name: displayName,
    account_type: accountTypeSchema.nullable().default(null),
    account_uuid: uuidSchema.nullable().default(null),
  })
  .refine((r) => (r.account_type === null) === (r.account_uuid === null), {
    message: 'account_type and account_uuid are given together or not at all.',
    path: ['account_uuid'],
  });

const realmEditSchema = z
  .object({ realm_name: realmName.optional(), display_name: displayName.optional() })
  .refine((e) => e.realm_name !== undefined || e.display_name !== undefined, {
    message: 'Give realm_name, display_name, or both.',
  });

/** Turns a refused realm write into the matching HTTP error. */
function refused(reason: RealmRefusal): Error {
  switch (reason) {
    case 'type_not_found':
      return errors.notFound('realm_type_not_found', 'No such realm type.');
    case 'name_taken':
      return errors.conflict('realm_name_taken', 'Another realm has this name.');
    case 'id_taken':
      return errors.conflict('realm_exists', 'A realm with this id already exists.');
    case 'not_found':
      return errors.notFound('realm_not_found', 'No such realm.');
    case 'has_worlds':
      return errors.conflict('realm_has_worlds', 'Move or remove the realm\'s worlds first.');
    case 'world_not_found':
      return errors.notFound('world_not_found', 'No such world.');
  }
}

/**
 * MCRealm's routes, under `/api/mcrealm`: the shared accounts, session lock,
 * worlds and chests, realm types, realms, which realm each world belongs to,
 * and every account's inventory pages, ender chest pages and equipment kept
 * per realm under `/realms/:realmId/accounts/...`, so nothing crosses realms.
 */
export function createCentralRealmRouter(
  universe: UniverseRepository,
  realms: CentralRealmRepository,
  pages: PageStore,
  clock: Clock,
): Router {
  const router = createUniverseRouter(universe, clock);
  const now = () => iso(clock.now());

  router.get('/realm-types', async (_req, res) => {
    res.json({ realm_types: await realms.realmTypes() });
  });

  router.put('/realm-types/:code', async (req, res) => {
    const code = systemCode.safeParse(pathParam(req, 'code'));
    if (!code.success) throw errors.badRequest('invalid_system_code', 'code is not a system code.');
    const { display_name } = realmTypeBody.parse(req.body);
    res.json({ realm_type: await realms.putRealmType(code.data, display_name, now()) });
  });

  router.get('/realms', async (_req, res) => {
    res.json({ realms: await realms.realms() });
  });

  router.post('/realms', async (req, res) => {
    const body = newRealmSchema.parse(req.body);
    const result = await realms.createRealm({ ...body, id: body.id ?? randomUUID() }, now());
    if (!result.ok) throw refused(result.reason);
    res.status(201).json({ realm: result.value });
  });

  router.get('/realms/:realmId', async (req, res) => {
    const realm = await realms.realm(uuidParam(req, 'realmId'));
    if (realm === undefined) throw refused('not_found');
    res.json({ realm });
  });

  router.patch('/realms/:realmId', async (req, res) => {
    const result = await realms.editRealm(uuidParam(req, 'realmId'), realmEditSchema.parse(req.body), now());
    if (!result.ok) throw refused(result.reason);
    res.json({ realm: result.value });
  });

  router.delete('/realms/:realmId', async (req, res) => {
    const result = await realms.deleteRealm(uuidParam(req, 'realmId'));
    if (!result.ok) throw refused(result.reason);
    res.status(204).end();
  });

  router.put('/realms/:realmId/worlds/:worldId', async (req, res) => {
    const result = await realms.assignWorld(uuidParam(req, 'realmId'), uuidParam(req, 'worldId'), now());
    if (!result.ok) throw refused(result.reason);
    res.status(204).end();
  });

  router.delete('/realms/:realmId/worlds/:worldId', async (req, res) => {
    if (!(await realms.unassignWorld(uuidParam(req, 'realmId'), uuidParam(req, 'worldId')))) {
      throw errors.notFound('world_not_in_realm', 'This world is not in this realm.');
    }
    res.status(204).end();
  });

  router.get('/worlds/:worldId/realm', async (req, res) => {
    const realm = await realms.realmOfWorld(uuidParam(req, 'worldId'));
    if (realm === undefined) throw errors.notFound('world_not_in_realm', 'This world is in no realm.');
    res.json({ realm });
  });

  const realmScope = async (req: Request) => {
    const realmId = uuidParam(req, 'realmId');
    if ((await realms.realm(realmId)) === undefined) throw refused('not_found');
    return { realm_id: realmId };
  };
  mountPageRoutes(router, '/realms/:realmId', pages, realmScope, clock);

  return router;
}
