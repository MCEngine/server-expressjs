import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SignJWT } from 'jose';
import { buildStack, guardedApp, refreshCookieOf, START, type Stack } from './auth-helpers.js';
import { hashPassword, needsRehash, verifyPassword } from '../src/modules/auth/password.js';
import { addDays } from '../src/lib/clock.js';

const REGISTER = {
  handle: 'alice',
  displayName: 'Alice',
  email: 'alice@example.com',
  password: 'correct horse battery staple',
};

describe('password hashing', () => {
  it('round-trips, and rejects the wrong password', async () => {
    const hash = await hashPassword('a good long passphrase');
    await expect(verifyPassword('a good long passphrase', hash)).resolves.toBe(true);
    await expect(verifyPassword('a good long passphras', hash)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('same', a)).resolves.toBe(true);
    await expect(verifyPassword('same', b)).resolves.toBe(true);
  });

  it('carries its parameters, so cost can be raised without breaking old hashes', async () => {
    const hash = await hashPassword('x'.repeat(20));
    expect(hash.split('$').slice(0, 4)).toEqual(['scrypt', '65536', '8', '1']);
    expect(needsRehash(hash)).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$c2FsdA$aGFzaA')).toBe(true);
  });

  it('returns false rather than throwing on a corrupted row', async () => {
    for (const bad of ['', 'garbage', 'scrypt$x$y$z$q$r', 'bcrypt$1$2$3$4$5']) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  it('treats equivalent Unicode forms as the same password', async () => {
    // NFC and NFD "café". Without normalization, whether you can sign in
    // depends on which keyboard you used.
    const hash = await hashPassword('café');
    await expect(verifyPassword('café', hash)).resolves.toBe(true);
  });
});

describe('auth', () => {
  let s: Stack;

  beforeEach(async () => {
    s = await buildStack();
  });

  afterEach(async () => {
    await s.destroy();
  });

  describe('register and login', () => {
    it('registers, returns an access token, and sets an HttpOnly refresh cookie', async () => {
      const res = await request(s.app).post('/api/v1/auth/register').send(REGISTER);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
      expect(res.body.access_token).toEqual(expect.any(String));
      // The refresh token must not be readable by script on the panel origin.
      expect(res.body).not.toHaveProperty('refresh_token');

      const setCookie = res.headers['set-cookie'] as unknown as string[];
      const cookie = setCookie.find((c) => c.startsWith('mcpm_refresh='));
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/api/v1/auth');
    });

    it('refuses a password short enough to guess', async () => {
      const res = await request(s.app)
        .post('/api/v1/auth/register')
        .send({ ...REGISTER, password: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(JSON.stringify(res.body.error.details)).toContain('password');
    });

    it('logs in with the registered credential', async () => {
      await request(s.app).post('/api/v1/auth/register').send(REGISTER);
      const res = await request(s.app)
        .post('/api/v1/auth/login')
        .send({ email: REGISTER.email, password: REGISTER.password });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toEqual(expect.any(String));
    });

    it('answers a wrong password and an unknown address identically', async () => {
      await request(s.app).post('/api/v1/auth/register').send(REGISTER);

      const wrongPassword = await request(s.app)
        .post('/api/v1/auth/login')
        .send({ email: REGISTER.email, password: 'not the password at all' });
      const unknownEmail = await request(s.app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: REGISTER.password });

      // Same status, same code, same words: the response must not say which
      // addresses are registered.
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });
  });

  describe('sessions', () => {
    const registerAnd = async () => {
      const res = await request(s.app).post('/api/v1/auth/register').send(REGISTER);
      return { access: res.body.access_token as string, cookie: refreshCookieOf(res) };
    };

    it('rotates the refresh token, and the old one stops working', async () => {
      const { cookie } = await registerAnd();

      const first = await request(s.app).post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(first.status).toBe(200);
      const rotated = refreshCookieOf(first);
      expect(rotated).not.toBe(cookie);

      const replay = await request(s.app).post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(replay.status).toBe(401);
    });

    it('signs out everywhere when a revoked session’s token is replayed', async () => {
      const { cookie, access } = await registerAnd();
      await request(s.app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${access}`);

      const replay = await request(s.app).post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(replay.status).toBe(401);
      // A replayed token means it was captured, so refusing only this one is
      // not enough.
      expect(replay.body.error.code).toBe('refresh_token_reused');
    });

    it('keeps devices independent, which is the point of a session per device', async () => {
      await request(s.app).post('/api/v1/auth/register').send(REGISTER);

      const laptop = await request(s.app)
        .post('/api/v1/auth/login')
        .send({ email: REGISTER.email, password: REGISTER.password, deviceLabel: 'laptop' });
      const phone = await request(s.app)
        .post('/api/v1/auth/login')
        .send({ email: REGISTER.email, password: REGISTER.password, deviceLabel: 'phone' });

      const list = await request(s.app)
        .get('/api/v1/me/sessions')
        .set('Authorization', `Bearer ${laptop.body.access_token}`);
      expect(list.body.data).toHaveLength(3); // register, laptop, phone
      expect(list.body.data.filter((d: { current: boolean }) => d.current)).toHaveLength(1);

      // Revoking the phone must not touch the laptop.
      const phoneSession = list.body.data.find(
        (d: { device_label?: string }) => d.device_label === 'phone',
      );
      await request(s.app)
        .delete(`/api/v1/me/sessions/${phoneSession.id}`)
        .set('Authorization', `Bearer ${laptop.body.access_token}`);

      const stillWorks = await request(s.app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${laptop.body.access_token}`);
      expect(stillWorks.status).toBe(200);

      const nowRejected = await request(s.app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${phone.body.access_token}`);
      expect(nowRejected.status).toBe(401);
    });

    it('rejects an access token whose session was revoked, before it expires', async () => {
      const { access } = await registerAnd();
      expect((await request(s.app).get('/api/v1/me').set('Authorization', `Bearer ${access}`)).status).toBe(200);

      await request(s.app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${access}`);

      // The JWT is still perfectly valid and unexpired. Checking the session is
      // what makes signing out mean anything before the TTL runs out.
      const after = await request(s.app).get('/api/v1/me').set('Authorization', `Bearer ${access}`);
      expect(after.status).toBe(401);
    });

    it('rejects a refresh after the session has expired', async () => {
      const { cookie } = await registerAnd();
      s.at.value = addDays(new Date(START), 31);

      const res = await request(s.app).post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('session_expired');
    });
  });

  describe('access tokens', () => {
    it('rejects a tampered payload', async () => {
      const res = await request(s.app).post('/api/v1/auth/register').send(REGISTER);
      const [header, payload, signature] = (res.body.access_token as string).split('.');
      const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as { sub: string };
      decoded.sub = 'somebody-else';
      const forged = `${header}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;

      const check = await request(s.app).get('/api/v1/me').set('Authorization', `Bearer ${forged}`);
      expect(check.status).toBe(401);
    });

    it('rejects a token signed with a different key', async () => {
      const foreign = await new SignJWT({ sid: 'x' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('someone')
        .setIssuer('mcpluginmanager')
        .setAudience('mcpluginmanager-api')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode('b'.repeat(32)));

      const res = await request(s.app).get('/api/v1/me').set('Authorization', `Bearer ${foreign}`);
      expect(res.status).toBe(401);
    });

    it('rejects a token from another issuer or audience', async () => {
      const key = new TextEncoder().encode(s.config.JWT_SECRET);
      const wrongAudience = await new SignJWT({ sid: 'x' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('someone')
        .setIssuer('mcpluginmanager')
        .setAudience('some-other-service')
        .setExpirationTime('1h')
        .sign(key);

      const res = await request(s.app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${wrongAudience}`);
      expect(res.status).toBe(401);
    });

    it('rejects an unsigned token claiming alg none', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'someone',
          sid: 'x',
          iss: 'mcpluginmanager',
          aud: 'mcpluginmanager-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url');

      const res = await request(s.app).get('/api/v1/me').set('Authorization', `Bearer ${header}.${payload}.`);
      expect(res.status).toBe(401);
    });

    it('rejects garbage without treating it as a defect', async () => {
      for (const value of ['', 'not-a-token', 'a.b.c', 'mcpm_tooshort']) {
        const res = await request(s.app).get('/api/v1/me').set('Authorization', `Bearer ${value}`);
        expect(res.status).toBe(401);
      }
    });
  });

  describe('API tokens', () => {
    const registerAnd = async () => {
      const res = await request(s.app).post('/api/v1/auth/register').send(REGISTER);
      return res.body.access_token as string;
    };

    it('returns the secret exactly once, and never again', async () => {
      const access = await registerAnd();
      const created = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'ci', scopes: ['artifact:write'] });

      expect(created.status).toBe(201);
      expect(created.body.token).toMatch(/^mcpm_/);

      const listed = await request(s.app).get('/api/v1/tokens').set('Authorization', `Bearer ${access}`);
      expect(listed.body.data).toHaveLength(1);
      expect(listed.body.data[0]).not.toHaveProperty('token');
      expect(listed.body.data[0].prefix).toHaveLength(8);
      expect(JSON.stringify(listed.body)).not.toContain(created.body.token);
    });

    it('does not store the token, only its digest', async () => {
      const access = await registerAnd();
      const created = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'ci', scopes: ['artifact:read'] });

      const rows = await s.db.db.selectFrom('api_tokens').selectAll().execute();
      expect(rows[0]!.token_hash).not.toBe(created.body.token);
      expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('authenticates with the minted token', async () => {
      const access = await registerAnd();
      const created = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'ci', scopes: ['artifact:read'] });

      const app = guardedApp(s.auth, 'scope', 'artifact:read');
      const res = await request(app).get('/guarded').set('Authorization', `Bearer ${created.body.token}`);
      expect(res.status).toBe(200);
      expect(res.body.actor).toBe('token');
    });

    it('refuses a scope the token does not hold', async () => {
      const access = await registerAnd();
      const created = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'read only', scopes: ['artifact:read'] });

      const app = guardedApp(s.auth, 'scope', 'artifact:write');
      const res = await request(app).get('/guarded').set('Authorization', `Bearer ${created.body.token}`);
      // 403, not 404: the caller is authenticated, and hiding existence from
      // them only makes the failure harder to debug.
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('missing_scope');
    });

    it('lets a session satisfy any scope', async () => {
      const access = await registerAnd();
      const app = guardedApp(s.auth, 'scope', 'artifact:write');
      const res = await request(app).get('/guarded').set('Authorization', `Bearer ${access}`);
      expect(res.status).toBe(200);
      expect(res.body.actor).toBe('session');
    });

    it('refuses a token acting where a person is required', async () => {
      const access = await registerAnd();
      const created = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'ci', scopes: ['artifact:write'] });

      // Otherwise a leaked CI credential could mint itself a wider one.
      const res = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${created.body.token}`)
        .send({ name: 'escalated', scopes: ['product:write'] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('session_required');
    });

    it('stops working the moment it is revoked', async () => {
      const access = await registerAnd();
      const created = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'ci', scopes: ['artifact:read'] });

      const app = guardedApp(s.auth, 'scope', 'artifact:read');
      expect((await request(app).get('/guarded').set('Authorization', `Bearer ${created.body.token}`)).status).toBe(200);

      await request(s.app)
        .delete(`/api/v1/tokens/${created.body.id}`)
        .set('Authorization', `Bearer ${access}`);

      expect((await request(app).get('/guarded').set('Authorization', `Bearer ${created.body.token}`)).status).toBe(401);
    });

    it('stops working once it expires', async () => {
      const access = await registerAnd();
      const created = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'short lived', scopes: ['artifact:read'], expiresInDays: 7 });

      const app = guardedApp(s.auth, 'scope', 'artifact:read');
      expect((await request(app).get('/guarded').set('Authorization', `Bearer ${created.body.token}`)).status).toBe(200);

      s.at.value = addDays(new Date(START), 8);
      expect((await request(app).get('/guarded').set('Authorization', `Bearer ${created.body.token}`)).status).toBe(401);
    });

    it('refuses a scope that does not exist', async () => {
      const access = await registerAnd();
      const res = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'bad', scopes: ['artifact:everything'] });
      expect(res.status).toBe(400);
    });

    it('will not revoke someone else’s token', async () => {
      const alice = await registerAnd();
      const created = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${alice}`)
        .send({ name: 'alice ci', scopes: ['artifact:read'] });

      const bobRes = await request(s.app)
        .post('/api/v1/auth/register')
        .send({ ...REGISTER, handle: 'bob', email: 'bob@example.com' });

      const res = await request(s.app)
        .delete(`/api/v1/tokens/${created.body.id}`)
        .set('Authorization', `Bearer ${bobRes.body.access_token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('guards', () => {
    it('rejects an anonymous request to a protected route', async () => {
      const res = await request(s.app).get('/api/v1/me');
      expect(res.status).toBe(401);
    });

    it('leaves public routes reachable without a credential', async () => {
      await request(s.app).post('/api/v1/auth/register').send(REGISTER);
      const res = await request(s.app).get('/api/v1/accounts/alice');
      expect(res.status).toBe(200);
    });

    it('ignores an unparseable Authorization header rather than failing the request', async () => {
      await request(s.app).post('/api/v1/auth/register').send(REGISTER);
      const res = await request(s.app).get('/api/v1/accounts/alice').set('Authorization', 'Basic abc');
      expect(res.status).toBe(200);
    });
  });
});
