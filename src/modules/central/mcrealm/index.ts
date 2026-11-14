import type { Router } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../../../db/schema.js';
import type { Clock } from '../../../lib/clock.js';
import { createPageStore, createUniverseRepository, type PageStore, type UniverseRepository } from '../universe/index.js';
import { createCentralRealmRepository, type CentralRealmRepository } from './repository.js';
import { createCentralRealmRouter } from './routes.js';

export type { CentralRealmRepository, Realm, RealmType } from './repository.js';

/** MCRealm's central storage: the shared tables, its realms, and its pages kept per realm. */
export interface CentralRealmServices {
  readonly universe: UniverseRepository;
  readonly realms: CentralRealmRepository;
  readonly pages: PageStore;
}

export function createCentralRealmServices(db: Kysely<Database>): CentralRealmServices {
  return {
    universe: createUniverseRepository(db),
    realms: createCentralRealmRepository(db),
    pages: createPageStore(db, {
      inventory: 'mcrealm_account_inventory',
      enderchest: 'mcrealm_account_enderchest',
      equipment: 'mcrealm_account_equipment',
    }),
  };
}

export function createCentralRealmRouterFor(services: CentralRealmServices, clock: Clock): Router {
  return createCentralRealmRouter(services.universe, services.realms, services.pages, clock);
}
