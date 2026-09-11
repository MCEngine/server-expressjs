import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildStack, type Stack } from './auth-helpers.js';

const PASSWORD = 'a sufficiently long passphrase';

/**
 * Who an API token may belong to.
 *
 * `POST /tokens` takes an `ownerAccountId`, and the token it mints authenticates
 * **as that account**. Account ids are public, so the check that the caller may
 * act for it is the only thing standing between a signed-in stranger and
 * somebody else's publishing rights.
 */
describe('token ownership', () => {
  let s: Stack;

  const registerAs = async (handle: string) => {
    const res = await request(s.app).post('/api/v1/auth/register').send({
      handle,
      displayName: handle,
      email: `${handle}@example.com`,
      password: PASSWORD,
    });
    expect(res.status).toBe(201);
    return res.body.access_token as string;
  };

  const accountId = async (handle: string) => {
    const res = await request(s.app).get(`/api/v1/accounts/${handle}`);
    expect(res.status).toBe(200);
    return res.body.id as string;
  };

  const mint = (access: string, body: Record<string, unknown>) =>
    request(s.app).post('/api/v1/tokens').set('Authorization', `Bearer ${access}`).send(body);

  beforeEach(async () => {
    s = await buildStack();
  });

  afterEach(async () => {
    await s.destroy();
  });

  it('refuses a token owned by somebody else, whose id is public', async () => {
    const alice = await registerAs('alice');
    await registerAs('mallory');
    const mallory = await request(s.app).post('/api/v1/auth/login').send({
      email: 'mallory@example.com',
      password: PASSWORD,
    });

    // Nothing secret was needed to find this: the account route is public.
    const victim = await accountId('alice');
    expect(victim).toEqual(expect.any(String));

    const stolen = await mint(mallory.body.access_token as string, {
      name: 'not mine',
      scopes: ['artifact:write'],
      ownerAccountId: victim,
    });

    expect(stolen.status).toBe(404);
    expect(stolen.body.error.code).toBe('account_not_found');

    // And nothing was written: Alice's token list is still empty.
    const alicesTokens = await request(s.app)
      .get('/api/v1/tokens')
      .set('Authorization', `Bearer ${alice}`);
    expect(alicesTokens.body.data).toHaveLength(0);
  });

  it('still mints a token for the caller', async () => {
    const alice = await registerAs('alice');
    const own = await mint(alice, { name: 'ci', scopes: ['artifact:write'] });
    expect(own.status).toBe(201);
    expect(own.body.token).toMatch(/^mcpm_/);
  });

  it('mints a token owned by an organization the caller administers', async () => {
    const alice = await registerAs('alice');
    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${alice}`)
      .send({ handle: 'acme', displayName: 'Acme' })
      .expect(201);

    const created = await mint(alice, {
      name: 'acme ci',
      scopes: ['artifact:write'],
      ownerAccountId: await accountId('acme'),
    });

    expect(created.status).toBe(201);
    // The caller's own list does not carry it: it belongs to the org.
    const mine = await request(s.app).get('/api/v1/tokens').set('Authorization', `Bearer ${alice}`);
    expect(mine.body.data).toHaveLength(0);
  });

  it('refuses an organization the caller is not in', async () => {
    const alice = await registerAs('alice');
    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${alice}`)
      .send({ handle: 'acme', displayName: 'Acme' })
      .expect(201);

    const mallory = await registerAs('mallory');
    const attempt = await mint(mallory, {
      name: 'acme ci',
      scopes: ['artifact:write'],
      ownerAccountId: await accountId('acme'),
    });

    // 404, not 403: a non-member does not learn the organization exists.
    expect(attempt.status).toBe(404);
  });

  it('refuses a member below admin', async () => {
    const alice = await registerAs('alice');
    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${alice}`)
      .send({ handle: 'acme', displayName: 'Acme' })
      .expect(201);

    const bob = await registerAs('bob');
    await request(s.app)
      .post('/api/v1/orgs/acme/members')
      .set('Authorization', `Bearer ${alice}`)
      // 204: the route adds the member and returns no body.
      .send({ handle: 'bob', role: 'maintainer' })
      .expect(204);

    const attempt = await mint(bob, {
      name: 'acme ci',
      scopes: ['artifact:write'],
      ownerAccountId: await accountId('acme'),
    });

    // A maintainer may publish; minting a credential for the whole org is an
    // admin's to do.
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.code).toBe('insufficient_role');
  });
});
