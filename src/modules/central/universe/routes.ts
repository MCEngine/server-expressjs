import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { errors } from '../../../errors.js';
import { pathParam } from '../../../http/params.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { uuidParam, uuidSchema } from '../http.js';
import type { PageKind, PageScope, PageStore } from './pages.js';
import type { AccountKey, BlockPosition, UniverseRepository } from './repository.js';

/**
 * An account type: `player`, `clan`, `guild`, or any type another plugin
 * defines, in lower-case snake_case up to the 50 characters the plugins store.
 */
export const accountTypeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, 'Not an account type.');

/** Base64 item contents as the plugins write them; empty is never valid. */
export const contentsSchema = z.string().min(1).max(4_000_000).regex(/^[A-Za-z0-9+/=\r\n]+$/, 'Not Base64.');

const pageLimit = z.number().int().min(1).max(1000);
const pageNumber = z.number().int().min(1).max(1000);
const worldName = z.string().regex(/^[A-Za-z0-9_\-.]{1,64}$/, 'Not a world name.');
const environment = z.enum(['normal', 'nether', 'the_end']);

/** Reads the `:accountType/:accountUuid` pair every account route starts with. */
export function accountParam(req: Request): AccountKey {
  const type = accountTypeSchema.safeParse(pathParam(req, 'accountType'));
  if (!type.success) throw errors.badRequest('invalid_account_type', 'accountType is not an account type.');
  return { accountType: type.data, accountUuid: uuidParam(req, 'accountUuid') };
}

/** Reads a 1-based page number path parameter. */
function pageParam(req: Request): number {
  const raw = pathParam(req, 'page');
  if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1 || Number(raw) > 1000) {
    throw errors.badRequest('invalid_page', 'page is not a page number from 1 to 1000.');
  }
  return Number(raw);
}

/** Reads a block coordinate path parameter, which may be negative. */
function coordinate(req: Request, name: string): number {
  const raw = pathParam(req, name);
  if (!/^-?\d{1,9}$/.test(raw)) throw errors.badRequest('invalid_coordinate', `${name} is not a block coordinate.`);
  return Number(raw);
}

function blockParam(req: Request): BlockPosition {
  return { worldId: uuidParam(req, 'worldId'), x: coordinate(req, 'x'), y: coordinate(req, 'y'), z: coordinate(req, 'z') };
}

const limitsSchema = z
  .object({ inventory_page_limit: pageLimit.optional(), enderchest_page_limit: pageLimit.optional() })
  .refine((l) => l.inventory_page_limit !== undefined || l.enderchest_page_limit !== undefined, {
    message: 'Give inventory_page_limit, enderchest_page_limit, or both.',
  });

const sessionSchema = z.object({
  server_id: uuidSchema,
  stale_seconds: z.number().int().min(1).max(3600).default(30),
});

const releaseSchema = z.object({ server_id: uuidSchema });

const worldSchema = z
  .object({
    world_name: worldName,
    environment: environment.default('normal'),
    account_type: accountTypeSchema.nullable().default(null),
    account_uuid: uuidSchema.nullable().default(null),
  })
  .refine((w) => (w.account_type === null) === (w.account_uuid === null), {
    message: 'account_type and account_uuid are given together or not at all.',
    path: ['account_uuid'],
  });

const contentsBody = z.object({ contents: contentsSchema });

const snapshotSchema = z.object({
  inventory: z.array(z.object({ page_number: pageNumber, contents: contentsSchema })).max(1000).default([]),
  equipment: contentsSchema.nullable().default(null),
  enderchest: z.array(z.object({ page_number: pageNumber, contents: contentsSchema })).max(1000).default([]),
  release_session: z.object({ server_id: uuidSchema }).nullable().default(null),
});

/**
 * The routes for the tables MCMultiverse and MCRealm share: accounts and their
 * page limits, the cross-server session lock, worlds, and chest blocks. One
 * router serves both `/api/mcmultiverse` and `/api/mcrealm`.
 */
export function createUniverseRouter(repo: UniverseRepository, clock: Clock): Router {
  const router = Router();
  const now = () => iso(clock.now());

  router.put('/accounts/:accountType/:accountUuid', async (req, res) => {
    const { created, account } = await repo.ensureAccount(accountParam(req), now());
    res.status(created ? 201 : 200).json({ account });
  });

  router.get('/accounts/:accountType/:accountUuid', async (req, res) => {
    const account = await repo.account(accountParam(req));
    if (account === undefined) throw errors.notFound('account_not_found', 'No such account.');
    res.json({ account });
  });

  router.patch('/accounts/:accountType/:accountUuid/property', async (req, res) => {
    const account = await repo.setLimits(accountParam(req), limitsSchema.parse(req.body), now());
    if (account === undefined) throw errors.notFound('account_not_found', 'No such account.');
    res.json({ account });
  });

  router.post('/accounts/:accountType/:accountUuid/session', async (req, res) => {
    const body = sessionSchema.parse(req.body);
    const result = await repo.acquireSession(accountParam(req), body.server_id, body.stale_seconds, clock.now());
    if (!result.acquired) {
      throw errors.conflict('session_held', 'Another server holds this account.', {
        held_by: result.held_by,
        locked_at: result.locked_at,
      });
    }
    res.json({ session: { server_id: result.server_id, locked_at: result.locked_at } });
  });

  router.delete('/accounts/:accountType/:accountUuid/session', async (req, res) => {
    const body = releaseSchema.parse(req.body);
    const released = await repo.releaseSession(accountParam(req), body.server_id);
    res.json({ released });
  });

  router.get('/worlds', async (_req, res) => {
    res.json({ worlds: await repo.worlds() });
  });

  router.get('/worlds/by-name/:name', async (req, res) => {
    const name = worldName.safeParse(pathParam(req, 'name'));
    if (!name.success) throw errors.badRequest('invalid_world_name', 'name is not a world name.');
    const world = await repo.worldByName(name.data);
    if (world === undefined) throw errors.notFound('world_not_found', 'No such world.');
    res.json({ world });
  });

  router.get('/worlds/:worldId', async (req, res) => {
    const world = await repo.world(uuidParam(req, 'worldId'));
    if (world === undefined) throw errors.notFound('world_not_found', 'No such world.');
    res.json({ world });
  });

  router.put('/worlds/:worldId', async (req, res) => {
    const world = await repo.putWorld(uuidParam(req, 'worldId'), worldSchema.parse(req.body), now());
    if (world === undefined) throw errors.conflict('world_name_taken', 'Another world has this name.');
    res.json({ world });
  });

  router.delete('/worlds/:worldId', async (req, res) => {
    if (!(await repo.deleteWorld(uuidParam(req, 'worldId')))) throw errors.notFound('world_not_found', 'No such world.');
    res.status(204).end();
  });

  router.get('/worlds/:worldId/chests/:x/:y/:z', async (req, res) => {
    const chest = await repo.chest(blockParam(req));
    if (chest === undefined) throw errors.notFound('chest_not_found', 'No chest is stored at this block.');
    res.json({ chest });
  });

  router.put('/worlds/:worldId/chests/:x/:y/:z', async (req, res) => {
    const { contents } = contentsBody.parse(req.body);
    const chest = await repo.putChest(blockParam(req), contents, randomUUID(), now());
    if (chest === undefined) throw errors.notFound('world_not_found', 'No such world.');
    res.json({ chest });
  });

  router.delete('/worlds/:worldId/chests/:x/:y/:z', async (req, res) => {
    if (!(await repo.deleteChest(blockParam(req)))) throw errors.notFound('chest_not_found', 'No chest is stored at this block.');
    res.status(204).end();
  });

  return router;
}

/**
 * Mounts the inventory, ender chest, equipment and snapshot routes under
 * `base` (empty for MCMultiverse, `/realms/:realmId` for MCRealm). `scopeOf`
 * reads the extra key columns from the request and throws when the scope does
 * not exist.
 */
export function mountPageRoutes(
  router: Router,
  base: string,
  store: PageStore,
  scopeOf: (req: Request) => Promise<PageScope>,
  clock: Clock,
): void {
  const now = () => iso(clock.now());
  const account = `${base}/accounts/:accountType/:accountUuid`;

  for (const kind of ['inventory', 'enderchest'] as const satisfies readonly PageKind[]) {
    router.get(`${account}/${kind}`, async (req, res) => {
      const scope = await scopeOf(req);
      res.json({ pages: await store.pages(kind, scope, accountParam(req)) });
    });

    router.get(`${account}/${kind}/:page`, async (req, res) => {
      const scope = await scopeOf(req);
      const page = await store.page(kind, scope, accountParam(req), pageParam(req));
      if (page === undefined) throw errors.notFound('page_not_found', 'No such page is stored.');
      res.json({ page });
    });

    router.put(`${account}/${kind}/:page`, async (req, res) => {
      const scope = await scopeOf(req);
      const { contents } = contentsBody.parse(req.body);
      res.json({ page: await store.putPage(kind, scope, accountParam(req), pageParam(req), contents, now()) });
    });
  }

  router.get(`${account}/equipment`, async (req, res) => {
    const scope = await scopeOf(req);
    const equipment = await store.equipment(scope, accountParam(req));
    if (equipment === undefined) throw errors.notFound('equipment_not_found', 'No equipment is stored.');
    res.json({ equipment });
  });

  router.put(`${account}/equipment`, async (req, res) => {
    const scope = await scopeOf(req);
    const { contents } = contentsBody.parse(req.body);
    res.json({ equipment: await store.putEquipment(scope, accountParam(req), contents, now()) });
  });

  router.put(`${account}/snapshot`, async (req, res) => {
    const scope = await scopeOf(req);
    const body = snapshotSchema.parse(req.body);
    await store.saveSnapshot(
      scope,
      accountParam(req),
      {
        inventory: body.inventory,
        equipment: body.equipment,
        enderchest: body.enderchest,
        release_server_id: body.release_session?.server_id ?? null,
      },
      now(),
    );
    res.json({ saved: true });
  });
}
