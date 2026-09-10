import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { testApp } from './helpers.js';

describe('health', () => {
  it('reports liveness without checking anything', async () => {
    const failing = [{ name: 'database', check: () => Promise.reject(new Error('down')) }];
    const { app } = testApp(failing);

    // Liveness must stay 200 even with a dead dependency: a restart does not
    // fix an unreachable database, it just turns the outage into a crash loop.
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports ready when every probe passes', async () => {
    const { app } = testApp([{ name: 'database', check: () => Promise.resolve() }]);
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('reports 503 and names the failing dependency', async () => {
    const { app } = testApp([
      { name: 'database', check: () => Promise.resolve() },
      { name: 'storage', check: () => Promise.reject(new Error('disk full')) },
    ]);

    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.checks).toContainEqual({ name: 'storage', ok: false, error: 'disk full' });
  });
});
