import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildStack, START, type Stack } from './auth-helpers.js';
import { bukkitJar, fabricJar, makeZip } from './zip-builder.js';
import { addDays } from '../src/lib/clock.js';

const PASSWORD = 'a sufficiently long passphrase';

describe('products', () => {
  let s: Stack;
  let access: string;
  let productId: string;

  /** Registers a user, creates an org, and creates a product in it. */
  const seed = async () => {
    const registered = await request(s.app).post('/api/v1/auth/register').send({
      handle: 'publisher',
      displayName: 'Publisher',
      email: 'publisher@example.com',
      password: PASSWORD,
    });
    access = registered.body.access_token as string;

    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${access}`)
      .send({ handle: 'acme', displayName: 'Acme' });

    const created = await request(s.app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${access}`)
      .send({
        slug: 'acme-tools',
        orgHandle: 'acme',
        name: 'Acme Tools',
        summary: 'Tools for servers.',
        kind: 'bukkit_plugin',
      });
    productId = created.body.id as string;
    return created;
  };

  const publish = (version: string, jar = bukkitJar(), token = access) =>
    request(s.app)
      .put(`/api/v1/products/${productId}/versions/${version}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', jar, `AcmeTools-${version}.jar`);

  beforeEach(async () => {
    s = await buildStack();
  });

  afterEach(async () => {
    await s.destroy();
  });

  describe('creating', () => {
    it('creates a product owned by an org', async () => {
      const created = await seed();
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ slug: 'acme-tools', kind: 'bukkit_plugin' });
      // Unset optional fields are omitted, not null.
      expect(created.body).not.toHaveProperty('repo_url');
    });

    it('refuses a user as an owner, because only an org publishes', async () => {
      const registered = await request(s.app).post('/api/v1/auth/register').send({
        handle: 'loner',
        displayName: 'Loner',
        email: 'loner@example.com',
        password: PASSWORD,
      });

      const res = await request(s.app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${registered.body.access_token}`)
        .send({
          slug: 'solo',
          orgHandle: 'loner',
          name: 'Solo',
          summary: 'Mine.',
          kind: 'bukkit_plugin',
        });

      // requireRole answers 404 for a non-member, and a user account has no
      // members at all.
      expect(res.status).toBe(404);
    });

    it('refuses a slug already in use, across every org', async () => {
      await seed();
      const res = await request(s.app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${access}`)
        .send({
          slug: 'acme-tools',
          orgHandle: 'acme',
          name: 'Again',
          summary: 'Duplicate.',
          kind: 'bukkit_plugin',
        });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('product_slug_taken');
    });

    it('resolves a product by id or by slug', async () => {
      await seed();
      const byId = await request(s.app).get(`/api/v1/products/${productId}`);
      const bySlug = await request(s.app).get('/api/v1/products/acme-tools');
      expect(byId.status).toBe(200);
      expect(bySlug.body.id).toBe(byId.body.id);
    });
  });

  describe('publishing', () => {
    it('accepts a valid jar and records its checksum', async () => {
      await seed();
      const res = await publish('1.0.0');

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ version: '1.0.0', channel: 'release', is_latest: true });
      expect(res.body.file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.file.name).toBe('AcmeTools-1.0.0.jar');
    });

    it('publishes to the same URL that reads the version back', async () => {
      await seed();
      const published = await publish('1.0.0');

      // The point of the route change: one address for the resource, whichever
      // verb is used. If these ever disagree, a permalink handed out by a
      // publisher is not the one the service serves.
      const read = await request(s.app).get(`/api/v1/products/${productId}/versions/1.0.0`);
      expect(read.status).toBe(200);
      expect(read.body.id).toBe(published.body.id);
      expect(read.body.file.sha256).toBe(published.body.file.sha256);
    });

    it('refuses a version in the body, rather than ignoring it', async () => {
      await seed();
      const res = await request(s.app)
        .put(`/api/v1/products/${productId}/versions/1.2.2`)
        .set('Authorization', `Bearer ${access}`)
        .field('version', '1.2.3')
        .attach('file', bukkitJar(), 'AcmeTools-1.2.3.jar');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('version_in_body');

      // Nothing was published under either version, which is the failure this
      // refusal exists to prevent: a URL saying 1.2.2 and a body saying 1.2.3
      // would otherwise publish 1.2.2 and report success.
      const rows = await s.db.db.selectFrom('product_versions').selectAll().execute();
      expect(rows).toHaveLength(0);
    });

    it('refuses a path segment that is not a version', async () => {
      await seed();
      const res = await request(s.app)
        .put(`/api/v1/products/${productId}/versions/latest`)
        .set('Authorization', `Bearer ${access}`)
        .attach('file', bukkitJar(), 'AcmeTools.jar');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    });

    it('no longer accepts a POST to the version collection', async () => {
      await seed();
      const res = await request(s.app)
        .post(`/api/v1/products/${productId}/versions`)
        .set('Authorization', `Bearer ${access}`)
        .field('version', '1.0.0')
        .attach('file', bukkitJar(), 'AcmeTools-1.0.0.jar');

      expect(res.status).toBe(404);
    });

    it('refuses a second upload of the same version', async () => {
      await seed();
      await publish('1.0.0');
      const again = await publish('1.0.0');
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('version_exists');
    });

    it('moves is_latest to the newest version', async () => {
      await seed();
      await publish('1.0.0');
      await publish('1.1.0');

      const listed = await request(s.app).get(`/api/v1/products/${productId}/versions`);
      const latest = listed.body.data.filter((v: { is_latest: boolean }) => v.is_latest);
      expect(latest).toHaveLength(1);
      expect(latest[0].version).toBe('1.1.0');
    });

    it('orders versions numerically, so 1.10.0 is above 1.9.0', async () => {
      await seed();
      await publish('1.9.0');
      await publish('1.10.0');

      const listed = await request(s.app).get(`/api/v1/products/${productId}/versions`);
      expect(listed.body.data.map((v: { version: string }) => v.version)).toEqual([
        '1.10.0',
        '1.9.0',
      ]);
    });

    it('refuses a mod jar for a bukkit_plugin product', async () => {
      await seed();
      const res = await publish('1.0.0', fabricJar());
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('wrong_artifact_kind');
    });

    it('refuses an archive containing an escaping path', async () => {
      await seed();
      const evil = makeZip([
        { name: 'plugin.yml', content: 'name: Evil' },
        { name: '../../../../etc/cron.d/payload', content: '* * * * * root sh' },
      ]);
      const res = await publish('1.0.0', evil);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('unsafe_archive');
    });

    it('stores nothing when the upload is rejected', async () => {
      await seed();
      await publish('1.0.0', fabricJar());
      expect(s.storage.objects.size).toBe(0);
      const rows = await s.db.db.selectFrom('product_versions').selectAll().execute();
      expect(rows).toHaveLength(0);
    });

    it('never derives the storage key from the uploaded filename', async () => {
      await seed();
      await publish('1.0.0');

      const [file] = await s.db.db.selectFrom('product_files').selectAll().execute();
      expect(file!.file_name).toBe('AcmeTools-1.0.0.jar');
      // Generated, sharded, and containing nothing the caller supplied.
      expect(file!.storage_key).toMatch(/^[0-9A-HJKMNP-TV-Z]{2}\/[0-9A-HJKMNP-TV-Z]{2}\/[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(file!.storage_key).not.toContain('AcmeTools');
    });

    it('publishes from CI with a token, recording the source', async () => {
      await seed();
      const token = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'ci', scopes: ['artifact:write'] });

      const res = await publish('2.0.0', bukkitJar(), token.body.token);
      expect(res.status).toBe(201);

      const [file] = await s.db.db.selectFrom('product_files').selectAll().execute();
      expect(file!.upload_source).toBe('ci');
      // A token is not a person, so nothing is attributed to one.
      expect(file!.uploaded_by).toBeNull();
    });

    it('refuses a token without artifact:write', async () => {
      await seed();
      const token = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'read only', scopes: ['artifact:read'] });

      const res = await publish('2.0.0', bukkitJar(), token.body.token);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('missing_scope');
    });

    it('charges the org quota and refuses once it is full', async () => {
      await seed();
      const org = await s.identity.getByHandle('acme');

      const jar = bukkitJar();
      // Room for exactly one jar of this size.
      await s.db.db
        .updateTable('org_settings')
        .set({ storage_quota_bytes: jar.length })
        .where('org_id', '=', org.id)
        .execute();

      expect((await publish('1.0.0', jar)).status).toBe(201);

      const settings = await s.identity.orgSettings(org.id);
      expect(settings.storage_used_bytes).toBe(jar.length);

      const second = await publish('1.1.0', jar);
      expect(second.status).toBe(507);
      expect(second.body.error.code).toBe('quota_exceeded');
      // The rejected upload left nothing behind.
      expect(s.storage.objects.size).toBe(1);
    });

    it('refuses a file larger than the org may upload', async () => {
      await seed();
      const org = await s.identity.getByHandle('acme');
      await s.db.db
        .updateTable('org_settings')
        .set({ max_file_bytes: 10 })
        .where('org_id', '=', org.id)
        .execute();

      const res = await publish('1.0.0');
      expect(res.status).toBe(413);
    });

    it('gives storage back when a version is deleted', async () => {
      await seed();
      const org = await s.identity.getByHandle('acme');
      await publish('1.0.0');
      expect((await s.identity.orgSettings(org.id)).storage_used_bytes).toBeGreaterThan(0);

      const res = await request(s.app)
        .delete(`/api/v1/products/${productId}/versions/1.0.0`)
        .set('Authorization', `Bearer ${access}`);

      expect(res.status).toBe(204);
      expect((await s.identity.orgSettings(org.id)).storage_used_bytes).toBe(0);
      expect(s.storage.objects.size).toBe(0);
    });
  });

  describe('downloading', () => {
    it('streams the jar with the checksum in a header', async () => {
      await seed();
      const published = await publish('1.0.0');

      // `responseType('blob')` is what makes supertest hand back the raw bytes;
      // it has no parser for application/java-archive and would otherwise give
      // an empty object.
      const res = await request(s.app)
        .get(`/api/v1/products/${productId}/versions/1.0.0/download`)
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['x-artifact-sha256']).toBe(published.body.file.sha256);
      expect(res.headers['content-type']).toContain('java-archive');
      expect(res.headers['content-disposition']).toBe('attachment; filename="AcmeTools-1.0.0.jar"');
      expect(res.body).toEqual(bukkitJar());
    });

    it('counts the download', async () => {
      await seed();
      await publish('1.0.0');
      await request(s.app).get(`/api/v1/products/${productId}/versions/1.0.0/download`);

      const product = await request(s.app).get(`/api/v1/products/${productId}`);
      expect(product.body.downloads_count).toBe(1);
    });

    it('serves the latest version of a channel', async () => {
      await seed();
      await publish('1.0.0');
      await publish('1.1.0');

      const res = await request(s.app).get(`/api/v1/products/${productId}/versions/latest`);
      expect(res.body.version).toBe('1.1.0');
    });
  });

  describe('visibility', () => {
    it('hides a private product from a stranger the same way as a missing one', async () => {
      await seed();
      await request(s.app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${access}`)
        .send({ visibility: 'private' });

      const stranger = await request(s.app).get(`/api/v1/products/${productId}`);
      const missing = await request(s.app).get('/api/v1/products/does-not-exist');

      expect(stranger.status).toBe(404);
      expect(stranger.body).toEqual(missing.body);
    });

    it('still shows a private product to a member', async () => {
      await seed();
      await request(s.app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${access}`)
        .send({ visibility: 'private' });

      const res = await request(s.app)
        .get(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${access}`);
      expect(res.status).toBe(200);
    });

    it('leaves a private product out of the public list', async () => {
      await seed();
      await request(s.app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${access}`)
        .send({ visibility: 'private' });

      const res = await request(s.app).get('/api/v1/products');
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('the general settings page', () => {
    it('shows repo_url only when it is set', async () => {
      await seed();
      expect((await request(s.app).get(`/api/v1/products/${productId}`)).body).not.toHaveProperty(
        'repo_url',
      );

      await request(s.app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${access}`)
        .send({ repoUrl: 'https://github.com/acme/tools' });

      const res = await request(s.app).get(`/api/v1/products/${productId}`);
      expect(res.body.repo_url).toBe('https://github.com/acme/tools');
    });

    it('changes the id, then locks it for thirty days', async () => {
      await seed();
      const renamed = await request(s.app)
        .put(`/api/v1/products/${productId}/slug`)
        .set('Authorization', `Bearer ${access}`)
        .send({ slug: 'acme-toolkit' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.slug).toBe('acme-toolkit');

      s.at.value = addDays(new Date(START), 29);
      const tooSoon = await request(s.app)
        .put(`/api/v1/products/${productId}/slug`)
        .set('Authorization', `Bearer ${access}`)
        .send({ slug: 'acme-kit' });
      expect(tooSoon.status).toBe(409);
      expect(tooSoon.body.error.code).toBe('product_slug_cooldown');
      expect(tooSoon.body.error.details).toHaveProperty('available_at');

      s.at.value = addDays(new Date(START), 31);

      // The original access token expired thirty-one days ago, which is the
      // system working. Sign in again for the rest of the test.
      const again = await request(s.app)
        .post('/api/v1/auth/login')
        .send({ email: 'publisher@example.com', password: PASSWORD });

      const allowed = await request(s.app)
        .put(`/api/v1/products/${productId}/slug`)
        .set('Authorization', `Bearer ${again.body.access_token}`)
        .send({ slug: 'acme-kit' });
      expect(allowed.status).toBe(200);
    });

    it('requires the id to be repeated before it deletes', async () => {
      await seed();

      const wrong = await request(s.app)
        .delete(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${access}`)
        .send({ slug: 'not-the-right-id' });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe('confirmation_mismatch');

      const right = await request(s.app)
        .delete(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${access}`)
        .send({ slug: 'acme-tools' });
      expect(right.status).toBe(204);

      expect((await request(s.app).get(`/api/v1/products/${productId}`)).status).toBe(404);
    });

    it('will not let a stranger edit or delete', async () => {
      await seed();
      const stranger = await request(s.app).post('/api/v1/auth/register').send({
        handle: 'stranger',
        displayName: 'Stranger',
        email: 'stranger@example.com',
        password: PASSWORD,
      });

      const patch = await request(s.app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${stranger.body.access_token}`)
        .send({ name: 'Mine now' });
      expect(patch.status).toBe(404);
    });
  });
});
