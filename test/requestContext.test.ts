import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { testApp } from './helpers.js';

describe('request id', () => {
  it('assigns one and echoes it', async () => {
    const { app } = testApp();
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('honours an inbound id so a trace survives into this service', async () => {
    const { app } = testApp();
    const res = await request(app).get('/health').set('X-Request-Id', 'lb-abc123');
    expect(res.headers['x-request-id']).toBe('lb-abc123');
  });

  it('replaces an inbound id that could inject into a header or a log line', async () => {
    const { app } = testApp();
    const res = await request(app).get('/health').set('X-Request-Id', 'a b"c');
    expect(res.headers['x-request-id']).not.toBe('a b"c');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces an inbound id long enough to bloat every log line', async () => {
    const { app } = testApp();
    const res = await request(app).get('/health').set('X-Request-Id', 'x'.repeat(500));
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
