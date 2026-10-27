import type { Express } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import { requireServerToken } from './guard.js';
import { createCentralIdentityRepository, createCentralIdentityRouter, type CentralIdentityRepository } from './identity/index.js';
import { createCentralEconomyRepository, createCentralEconomyRouter, type CentralEconomyRepository } from './economy/index.js';
import { createCentralMcagentsRepository, createCentralMcagentsRouter, type CentralMcagentsRepository } from './mcagents/index.js';

export { requireServerToken } from './guard.js';

/**
 * What the central plugin routes need: one repository per plugin family, and
 * the clock their timestamps come from.
 */
export interface CentralServices {
  readonly clock: Clock;
  readonly identity: CentralIdentityRepository;
  readonly economy: CentralEconomyRepository;
  readonly mcagents: CentralMcagentsRepository;
}

export function createCentralServices(db: Kysely<Database>, clock: Clock): CentralServices {
  return {
    clock,
    identity: createCentralIdentityRepository(db),
    economy: createCentralEconomyRepository(db),
    mcagents: createCentralMcagentsRepository(db),
  };
}

/**
 * Mounts every central plugin route behind the shared secret.
 *
 * Each family is mounted at its own exact prefix rather than under one shared
 * parent, because the released plugins already call these paths and one of
 * them -- `/v1` -- sits beside this service's own `/api/v1`. The guard is
 * attached per prefix, so it never sees a request meant for anything else.
 */
export function mountCentral(app: Express, central: CentralServices, secret: string): void {
  const guard = requireServerToken(secret);
  app.use('/v1', guard, createCentralIdentityRouter(central.identity, central.clock));
  app.use('/api/economy', guard, createCentralEconomyRouter(central.economy, central.clock));
  app.use('/api/mcagents', guard, createCentralMcagentsRouter(central.mcagents, central.clock));
}
