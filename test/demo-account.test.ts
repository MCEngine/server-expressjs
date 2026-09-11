import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildStack, type Stack } from './auth-helpers.js';
import { recordingLogger } from './helpers.js';
import { seedDemoAccount } from '../src/modules/auth/demo.js';

const DEMO = {
  DEMO_ACCOUNT_ENABLED: 'true',
  DEMO_ACCOUNT_HANDLE: 'demo',
  DEMO_ACCOUNT_EMAIL: 'demo@example.test',
  DEMO_ACCOUNT_PASSWORD: 'a-demo-password',
};

describe('the demo account', () => {
  let s: Stack;
  afterEach(async () => {
    await s.destroy();
  });

  it('creates nothing when the flag is off', async () => {
    s = await buildStack();
    const logger = recordingLogger();
    await seedDemoAccount(s.config, s.auth, logger);

    expect(logger.lines).toEqual([]);
    const res = await request(s.app).post('/api/v1/auth/login').send({
      email: 'demo@example.test',
      password: 'a-demo-password',
    });
    expect(res.status).toBe(401);
  });

  it('creates an account a person can actually sign in with', async () => {
    s = await buildStack(DEMO);
    await seedDemoAccount(s.config, s.auth, recordingLogger());

    // The point of seeding through `register` rather than inserting a row: what
    // it produces is indistinguishable from an account someone made.
    const res = await request(s.app).post('/api/v1/auth/login').send({
      email: DEMO.DEMO_ACCOUNT_EMAIL,
      password: DEMO.DEMO_ACCOUNT_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTypeOf('string');

    const me = await request(s.app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${res.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.handle).toBe('demo');
  });

  it('warns every time it is enabled, naming the risk', async () => {
    s = await buildStack(DEMO);
    const logger = recordingLogger();
    await seedDemoAccount(s.config, s.auth, logger);

    expect(logger.lines.filter((line) => line.level === 'warn').map((line) => line.message)).toEqual(
      ['demo account enabled'],
    );
  });

  it('is idempotent, so a restart is a no-op rather than an error', async () => {
    s = await buildStack(DEMO);
    await seedDemoAccount(s.config, s.auth, recordingLogger());

    // The second call is what a redeploy onto an existing volume does.
    await expect(seedDemoAccount(s.config, s.auth, recordingLogger())).resolves.toBeUndefined();

    const res = await request(s.app).post('/api/v1/auth/login').send({
      email: DEMO.DEMO_ACCOUNT_EMAIL,
      password: DEMO.DEMO_ACCOUNT_PASSWORD,
    });
    expect(res.status).toBe(200);
  });

  it('never fails startup, even when the account cannot be created', async () => {
    s = await buildStack({ ...DEMO, DEMO_ACCOUNT_HANDLE: 'new' });
    // `new` is reserved, so registering it throws. A convenience that cannot be
    // provided must not become an outage.
    await expect(seedDemoAccount(s.config, s.auth, recordingLogger())).resolves.toBeUndefined();
  });

  it('leaves registering and signing in exactly as they were', async () => {
    s = await buildStack(DEMO);
    await seedDemoAccount(s.config, s.auth, recordingLogger());

    // The demo account is an addition, not a replacement: someone must still be
    // able to register their own and sign in with it.
    const registered = await request(s.app).post('/api/v1/auth/register').send({
      handle: 'alice',
      displayName: 'Alice',
      email: 'alice@example.com',
      password: 'correct horse battery staple',
    });
    expect(registered.status).toBe(201);

    const login = await request(s.app).post('/api/v1/auth/login').send({
      email: 'alice@example.com',
      password: 'correct horse battery staple',
    });
    expect(login.status).toBe(200);
  });
});
