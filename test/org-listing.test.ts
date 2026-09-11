import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildStack, type Stack } from './auth-helpers.js';

const PASSWORD = 'a sufficiently long passphrase';

describe('the organizations you are in', () => {
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

  const myOrgs = (access: string) =>
    request(s.app).get('/api/v1/me/orgs').set('Authorization', `Bearer ${access}`);

  beforeEach(async () => {
    s = await buildStack();
  });

  afterEach(async () => {
    await s.destroy();
  });

  it('is empty for an account that belongs to none', async () => {
    const alice = await registerAs('alice');
    const res = await myOrgs(alice);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('carries the handle, the display name and the role held', async () => {
    const alice = await registerAs('alice');
    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${alice}`)
      .send({ handle: 'acme', displayName: 'Acme' })
      .expect(201);

    const res = await myOrgs(alice);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      role: 'owner',
      org: { handle: 'acme', display_name: 'Acme', type: 'org' },
    });
    expect(res.body.data[0].joined_at).toEqual(expect.any(String));
  });

  it('lists an organization somebody else owns, at the role held there', async () => {
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
      .send({ handle: 'bob', role: 'maintainer' })
      .expect(204);

    expect((await myOrgs(bob)).body.data).toMatchObject([
      { role: 'maintainer', org: { handle: 'acme' } },
    ]);
    // And it is the caller's list, not a listing of organizations: Bob's own
    // shows Acme because he is in it, Mallory's shows nothing.
    const mallory = await registerAs('mallory');
    expect((await myOrgs(mallory)).body.data).toEqual([]);
  });

  it('needs a signed-in person, not an API token', async () => {
    const alice = await registerAs('alice');
    const token = (
      await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${alice}`)
        .send({ name: 'ci', scopes: ['artifact:read'] })
    ).body.token as string;

    const res = await request(s.app).get('/api/v1/me/orgs').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('session_required');
  });
});
