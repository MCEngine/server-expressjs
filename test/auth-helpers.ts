import express, { type Express } from 'express';
import { freshDatabase, type TestDatabase } from './db-helpers.js';
import { testConfig, recordingLogger } from './helpers.js';
import { createApp } from '../src/app.js';
import { createIdentityRepository, createIdentityService, type IdentityService } from '../src/modules/identity/index.js';
import {
  attachActor,
  createAuthRepository,
  createAuthService,
  requireScope,
  requireSession,
  actorOf,
  type AuthService,
} from '../src/modules/auth/index.js';
import { createErrorHandler } from '../src/http/errorHandler.js';
import type { Clock } from '../src/lib/clock.js';
import type { Config } from '../src/config.js';

export interface Stack {
  db: TestDatabase;
  identity: IdentityService;
  auth: AuthService;
  app: Express;
  config: Config;
  at: { value: Date };
  destroy(): Promise<void>;
}

export const START = '2026-01-01T00:00:00.000Z';

export async function buildStack(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<Stack> {
  const db = await freshDatabase();
  const at = { value: new Date(START) };
  const clock: Clock = { now: () => at.value };
  const config = testConfig(overrides);

  const identity = createIdentityService(createIdentityRepository(db.db), clock);
  const auth = createAuthService(createAuthRepository(db.db), identity, config, clock);
  const app = createApp({
    config,
    logger: recordingLogger(),
    services: { identity, auth },
  });

  return {
    db,
    identity,
    auth,
    app,
    config,
    at,
    destroy: () => db.destroy(),
  };
}

/**
 * A tiny app exposing one route behind a guard, for testing the guard rather
 * than a route that happens to use it.
 */
export function guardedApp(auth: AuthService, guard: 'session' | 'scope', scope?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(attachActor(auth));
  app.get(
    '/guarded',
    guard === 'session' ? requireSession : requireScope(scope as never),
    (req, res) => {
      res.json({ actor: actorOf(req).kind });
    },
  );
  app.use(createErrorHandler(recordingLogger()));
  return app;
}

/** Extracts the refresh cookie from a supertest response. */
export function refreshCookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'] as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('mcpm_refresh='));
  if (cookie === undefined) throw new Error('No refresh cookie was set.');
  return cookie.split(';')[0]!;
}
