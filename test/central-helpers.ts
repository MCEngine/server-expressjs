import type { Express } from 'express';
import request from 'supertest';
import { freshDatabase, type TestDatabase } from './db-helpers.js';
import { recordingLogger, testConfig } from './helpers.js';
import { createApp } from '../src/app.js';
import { createCentralServices, type CentralOptions, type CentralServices } from '../src/modules/central/index.js';
import type { Clock } from '../src/lib/clock.js';

export const SECRET = 'a-central-secret-of-some-length';

export interface CentralStack {
  db: TestDatabase;
  central: CentralServices;
  app: Express;
  at: { value: Date };
  /** Request builders that carry the shared secret. */
  get(path: string): request.Test;
  post(path: string, body?: unknown): request.Test;
  put(path: string, body?: unknown): request.Test;
  patch(path: string, body?: unknown): request.Test;
  del(path: string): request.Test;
  destroy(): Promise<void>;
}

/**
 * An app with the central routes mounted on a fresh database.
 *
 * `overrides` reach the config, so a suite can turn the routes off by leaving
 * the secret out, and `options` lets a suite give the brain a fake AI API.
 */
export async function buildCentral(
  overrides: Partial<NodeJS.ProcessEnv> = { SERVER_API_TOKEN: SECRET },
  options: CentralOptions = {},
): Promise<CentralStack> {
  const db = await freshDatabase();
  const at = { value: new Date('2026-01-01T00:00:00.000Z') };
  const clock: Clock = { now: () => at.value };
  const central = createCentralServices(db.db, clock, options);
  const app = createApp({ config: testConfig(overrides), logger: recordingLogger(), services: { central } });
  const auth = (test: request.Test) => test.set('Authorization', `Bearer ${SECRET}`);

  return {
    db,
    central,
    app,
    at,
    get: (path) => auth(request(app).get(path)),
    post: (path, body) => auth(request(app).post(path)).send(body as object),
    put: (path, body) => auth(request(app).put(path)).send(body as object),
    patch: (path, body) => auth(request(app).patch(path)).send(body as object),
    del: (path) => auth(request(app).delete(path)),
    destroy: () => db.destroy(),
  };
}
