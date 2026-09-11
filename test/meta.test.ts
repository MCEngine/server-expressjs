import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { recordingLogger, testConfig } from './helpers.js';

describe('GET /meta', () => {
  it('says there is no demo account when the flag is off', async () => {
    const app = createApp({ config: testConfig(), logger: recordingLogger() });
    const res = await request(app).get('/api/v1/meta');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ demo_account: null });
  });

  it('advertises the credentials when the flag is on', async () => {
    const app = createApp({
      config: testConfig({
        DEMO_ACCOUNT_ENABLED: 'true',
        DEMO_ACCOUNT_EMAIL: 'demo@example.test',
        DEMO_ACCOUNT_PASSWORD: 'a-demo-password',
      }),
      logger: recordingLogger(),
    });
    const res = await request(app).get('/api/v1/meta');

    // The password is here on purpose: it is a credential the operator
    // published by turning the flag on, and the sign-in page is what needs it.
    expect(res.body).toEqual({
      demo_account: { email: 'demo@example.test', password: 'a-demo-password' },
    });
  });

  it('reads the literal string "false" as off', async () => {
    // `z.coerce.boolean()` would make this true, which is the bug this guards.
    const app = createApp({
      config: testConfig({ DEMO_ACCOUNT_ENABLED: 'false' }),
      logger: recordingLogger(),
    });
    expect((await request(app).get('/api/v1/meta')).body).toEqual({ demo_account: null });
  });

  it('needs no credentials', async () => {
    const app = createApp({ config: testConfig(), logger: recordingLogger() });
    expect((await request(app).get('/api/v1/meta')).status).toBe(200);
  });
});
