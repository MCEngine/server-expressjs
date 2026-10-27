import type { Express } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import { requireServerToken } from './guard.js';
import { createCentralIdentityRepository, createCentralIdentityRouter, type CentralIdentityRepository } from './identity/index.js';
import { createCentralEconomyRepository, createCentralEconomyRouter, type CentralEconomyRepository } from './economy/index.js';
import { createCentralMcagentsRepository, createCentralMcagentsRouter, type CentralMcagentsRepository } from './mcagents/index.js';
import { createCentralMembershipRepository, createCentralMembershipRouter, type CentralMembershipRepository } from './membership/index.js';
import { createCentralChatRepository, createCentralChatRouter, type CentralChatRepository } from './chat/index.js';
import { createCentralPackageRepository, createCentralPackageRouter, type CentralPackageRepository } from './packages/index.js';
import { createCentralLogRepository, createCentralLogRouter, type CentralLogRepository } from './mclog/index.js';
import {
  createBrainRouter,
  createBrainService,
  createKnowledgeRepository,
  createLlmClient,
  type BrainService,
  type BrainSettings,
  type KnowledgeRepository,
  type LlmClient,
} from './brain/index.js';

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
  readonly membership: CentralMembershipRepository;
  readonly chat: CentralChatRepository;
  readonly packages: CentralPackageRepository;
  readonly logs: CentralLogRepository;
  readonly knowledge: KnowledgeRepository;
  readonly brain: BrainService;
}

export interface CentralOptions {
  readonly brain?: Partial<BrainSettings>;
  /** The AI API client; a test passes a fake. */
  readonly llm?: LlmClient;
}

const DEFAULT_BRAIN: BrainSettings = {
  agentModel: 'openrouter/free',
  embeddingModel: 'openai/text-embedding-3-small',
  apiUrl: 'https://openrouter.ai/api/v1',
  maxSteps: 5,
};

export function createCentralServices(
  db: Kysely<Database>,
  clock: Clock,
  options: CentralOptions = {},
): CentralServices {
  const logs = createCentralLogRepository(db);
  const knowledge = createKnowledgeRepository(db);
  const brain = createBrainService(
    options.llm ?? createLlmClient(),
    knowledge,
    logs,
    { ...DEFAULT_BRAIN, ...options.brain },
    clock,
  );
  return {
    clock,
    identity: createCentralIdentityRepository(db),
    economy: createCentralEconomyRepository(db),
    mcagents: createCentralMcagentsRepository(db),
    membership: createCentralMembershipRepository(db),
    chat: createCentralChatRepository(db),
    packages: createCentralPackageRepository(db),
    logs,
    knowledge,
    brain,
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
  app.use('/api/mcagents', guard, createBrainRouter(central.brain, central.knowledge));
  app.use('/api/mcagents', guard, createCentralMcagentsRouter(central.mcagents, central.clock));
  app.use('/api/mcmembership', guard, createCentralMembershipRouter(central.membership, central.clock));
  app.use('/api/mcagents-chat', guard, createCentralChatRouter(central.chat, central.clock));
  app.use('/api/mcpackage', guard, createCentralPackageRouter(central.packages, central.clock));
  app.use('/api/mclog', guard, createCentralLogRouter(central.logs, central.clock));
}
