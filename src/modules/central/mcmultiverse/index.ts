import type { Router } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../../../db/schema.js';
import type { Clock } from '../../../lib/clock.js';
import {
  createPageStore,
  createUniverseRepository,
  createUniverseRouter,
  mountPageRoutes,
  type PageStore,
  type UniverseRepository,
} from '../universe/index.js';

/** MCMultiverse's central storage: the shared tables plus its own pages. */
export interface CentralMultiverseServices {
  readonly universe: UniverseRepository;
  readonly pages: PageStore;
}

export function createCentralMultiverseServices(db: Kysely<Database>): CentralMultiverseServices {
  return {
    universe: createUniverseRepository(db),
    pages: createPageStore(db, {
      inventory: 'mcmultiverse_account_inventory',
      enderchest: 'mcmultiverse_account_enderchest',
      equipment: 'mcmultiverse_account_equipment',
    }),
  };
}

/**
 * MCMultiverse's routes, under `/api/mcmultiverse`: one universe, so an
 * account's inventory pages, ender chest pages and equipment are the same in
 * every world and on every server of the network.
 */
export function createCentralMultiverseRouter(services: CentralMultiverseServices, clock: Clock): Router {
  const router = createUniverseRouter(services.universe, clock);
  mountPageRoutes(router, '', services.pages, () => Promise.resolve({}), clock);
  return router;
}

