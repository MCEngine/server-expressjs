import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildStack, type Stack } from './auth-helpers.js';
import { bukkitJar } from './zip-builder.js';

const PASSWORD = 'a sufficiently long passphrase';

/**
 * Tokens an organization owns.
 *
 * The point of them is CI that survives the person who set it up: the
 * credential belongs to the org, so it keeps working when they leave and stops
 * working when the org revokes it.
 */
describe("an organization's tokens", () => {
  let s: Stack;
  let alice: string;

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

  beforeEach(async () => {
    s = await buildStack();
    alice = await registerAs('alice');
    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${alice}`)
      .send({ handle: 'acme', displayName: 'Acme' })
      .expect(201);
  });

  afterEach(async () => {
    await s.destroy();
  });

  const mintOrgToken = (access: string, scopes: string[] = ['artifact:write', 'artifact:read']) =>
    request(s.app)
      .post('/api/v1/orgs/acme/tokens')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'ci', scopes });

  it('mints, lists and revokes, and shows the secret once', async () => {
    const created = await mintOrgToken(alice);
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    expect(token).toMatch(/^mcpm_/);

    const listed = await request(s.app)
      .get('/api/v1/orgs/acme/tokens')
      .set('Authorization', `Bearer ${alice}`);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).not.toHaveProperty('token');

    // Not in the caller's own list: it belongs to the org, not to Alice.
    const mine = await request(s.app).get('/api/v1/tokens').set('Authorization', `Bearer ${alice}`);
    expect(mine.body.data).toHaveLength(0);

    await request(s.app)
      .delete(`/api/v1/orgs/acme/tokens/${created.body.id}`)
      .set('Authorization', `Bearer ${alice}`)
      .expect(204);

    const after = await request(s.app)
      .get('/api/v1/orgs/acme/tokens')
      .set('Authorization', `Bearer ${alice}`);
    expect(after.body.data).toHaveLength(0);
  });

  it('publishes to the org that owns it', async () => {
    const token = (await mintOrgToken(alice)).body.token as string;

    const product = await request(s.app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${alice}`)
      .send({ orgHandle: 'acme', slug: 'acme-tools', name: 'Acme Tools', summary: 'Tools.', kind: 'bukkit_plugin' });
    expect(product.status).toBe(201);

    // The whole point: the org's own credential, publishing for the org,
    // with no membership row anywhere that names it.
    const published = await request(s.app)
      .put('/api/v1/products/acme-tools/versions/1.0.0')
      .set('Authorization', `Bearer ${token}`)
      .field('channel', 'release')
      .attach('file', bukkitJar('AcmeTools', '1.0.0'), 'acme.jar');

    expect(published.status).toBe(201);
  });

  it('reaches nothing outside its own organization', async () => {
    const token = (await mintOrgToken(alice)).body.token as string;

    const bob = await registerAs('bob');
    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${bob}`)
      .send({ handle: 'other', displayName: 'Other' })
      .expect(201);
    await request(s.app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${bob}`)
      .send({ orgHandle: 'other', slug: 'other-tools', name: 'Other Tools', summary: 'Tools.', kind: 'bukkit_plugin' })
      .expect(201);

    const attempt = await request(s.app)
      .put('/api/v1/products/other-tools/versions/1.0.0')
      .set('Authorization', `Bearer ${token}`)
      .field('channel', 'release')
      .attach('file', bukkitJar('OtherTools', '1.0.0'), 'other.jar');

    expect(attempt.status).toBe(404);
  });

  it('cannot administer the organization that owns it', async () => {
    const token = (await mintOrgToken(alice)).body.token as string;

    // A token carries the org's publishing rights and none of its governance:
    // every route that administers an org needs a signed-in person.
    const rename = await request(s.app)
      .patch('/api/v1/accounts/acme')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Taken Over' });
    expect(rename.status).toBe(403);
    expect(rename.body.error.code).toBe('session_required');

    const more = await request(s.app)
      .post('/api/v1/orgs/acme/tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'another', scopes: ['artifact:write'] });
    expect(more.status).toBe(403);
  });

  it('is refused to a member below admin, and to a stranger', async () => {
    const bob = await registerAs('bob');
    await request(s.app)
      .post('/api/v1/orgs/acme/members')
      .set('Authorization', `Bearer ${alice}`)
      .send({ handle: 'bob', role: 'maintainer' })
      .expect(204);

    expect((await mintOrgToken(bob)).status).toBe(403);
    expect(
      (await request(s.app).get('/api/v1/orgs/acme/tokens').set('Authorization', `Bearer ${bob}`))
        .status,
    ).toBe(403);

    const mallory = await registerAs('mallory');
    // 404 for a non-member: they do not learn the org exists.
    expect((await mintOrgToken(mallory)).status).toBe(404);
  });
});
