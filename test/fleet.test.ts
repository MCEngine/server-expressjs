import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildStack, type Stack } from './auth-helpers.js';
import { bukkitJar } from './zip-builder.js';

const PASSWORD = 'a sufficiently long passphrase';

describe('fleet', () => {
  let s: Stack;
  let access: string;
  let serverId: string;
  let fleetToken: string;
  let productId: string;

  /** An operator with one registered server, and a product with two versions. */
  const seed = async () => {
    const registered = await request(s.app).post('/api/v1/auth/register').send({
      handle: 'operator',
      displayName: 'Operator',
      email: 'operator@example.com',
      password: PASSWORD,
    });
    access = registered.body.access_token as string;

    const token = await request(s.app)
      .post('/api/v1/tokens')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'server', scopes: ['fleet:read', 'fleet:write', 'artifact:read'] });
    fleetToken = token.body.token as string;

    const server = await request(s.app)
      .post('/api/v1/fleet/servers')
      .set('Authorization', `Bearer ${fleetToken}`)
      .send({ name: 'survival' });
    serverId = server.body.id as string;

    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${access}`)
      .send({ handle: 'acme', displayName: 'Acme' });

    const product = await request(s.app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${access}`)
      .send({
        slug: 'essentials',
        orgHandle: 'acme',
        name: 'Essentials',
        summary: 'Everything.',
        kind: 'bukkit_plugin',
      });
    productId = product.body.id as string;

    for (const version of ['2.19.0', '2.20.1']) {
      await request(s.app)
        .put(`/api/v1/products/${productId}/versions/${version}`)
        .set('Authorization', `Bearer ${access}`)
        .attach('file', bukkitJar('Essentials', version), `Essentials-${version}.jar`);
    }

    return server;
  };

  const report = (plugins: unknown[]) =>
    request(s.app)
      .post(`/api/v1/fleet/servers/${serverId}/plugins`)
      .set('Authorization', `Bearer ${fleetToken}`)
      .send({ platform: 'paper', mcVersion: '1.21.11', agentVersion: '0.0.0', plugins });

  const desired = () =>
    request(s.app)
      .get(`/api/v1/fleet/servers/${serverId}/desired`)
      .set('Authorization', `Bearer ${fleetToken}`);

  beforeEach(async () => {
    s = await buildStack();
  });

  afterEach(async () => {
    await s.destroy();
  });

  describe('registering', () => {
    it('returns the server key exactly once', async () => {
      const created = await seed();
      expect(created.status).toBe(201);
      expect(created.body.server_key).toEqual(expect.any(String));

      // Never again: it is the credential the plugin's config.yml carries.
      const fetched = await request(s.app)
        .get(`/api/v1/fleet/servers/${serverId}`)
        .set('Authorization', `Bearer ${access}`);
      expect(fetched.body).not.toHaveProperty('server_key');

      const listed = await request(s.app)
        .get('/api/v1/fleet/servers')
        .set('Authorization', `Bearer ${access}`);
      expect(JSON.stringify(listed.body)).not.toContain(created.body.server_key);
    });

    it('hides another operator’s server the same way as a missing one', async () => {
      await seed();
      const stranger = await request(s.app).post('/api/v1/auth/register').send({
        handle: 'stranger',
        displayName: 'Stranger',
        email: 'stranger@example.com',
        password: PASSWORD,
      });

      const theirs = await request(s.app)
        .get(`/api/v1/fleet/servers/${serverId}`)
        .set('Authorization', `Bearer ${stranger.body.access_token}`);
      const missing = await request(s.app)
        .get('/api/v1/fleet/servers/01ABCDEFGHJKMNPQRSTVWXYZ00')
        .set('Authorization', `Bearer ${stranger.body.access_token}`);

      expect(theirs.status).toBe(404);
      expect(theirs.body).toEqual(missing.body);
    });

    it('allows the same URL for two operators but not twice for one', async () => {
      await seed();
      await request(s.app)
        .patch(`/api/v1/fleet/servers/${serverId}`)
        .set('Authorization', `Bearer ${access}`)
        .send({ serverUrl: 'https://play.example.com' });

      const second = await request(s.app)
        .post('/api/v1/fleet/servers')
        .set('Authorization', `Bearer ${fleetToken}`)
        .send({ name: 'creative' });

      const clash = await request(s.app)
        .patch(`/api/v1/fleet/servers/${second.body.id}`)
        .set('Authorization', `Bearer ${access}`)
        .send({ serverUrl: 'https://play.example.com' });
      expect(clash.status).toBe(409);
    });
  });

  describe('reporting an inventory', () => {
    it('records what is installed and updates the server’s facts', async () => {
      await seed();
      const res = await report([{ pluginId: 'Essentials', version: '2.19.0' }]);
      expect(res.status).toBe(204);

      const fetched = await request(s.app)
        .get(`/api/v1/fleet/servers/${serverId}`)
        .set('Authorization', `Bearer ${access}`);
      expect(fetched.body.platform).toBe('paper');
      expect(fetched.body.last_seen_at).toEqual(expect.any(String));
      expect(fetched.body.plugins).toEqual([
        expect.objectContaining({ plugin_id: 'Essentials', installed_version: '2.19.0' }),
      ]);
    });

    it('replaces rather than patches, so a hand-removed plugin disappears', async () => {
      await seed();
      await report([
        { pluginId: 'Essentials', version: '2.19.0' },
        { pluginId: 'Vault', version: '1.7.3' },
      ]);
      await report([{ pluginId: 'Essentials', version: '2.19.0' }]);

      const fetched = await request(s.app)
        .get(`/api/v1/fleet/servers/${serverId}`)
        .set('Authorization', `Bearer ${access}`);
      expect(fetched.body.plugins.map((p: { plugin_id: string }) => p.plugin_id)).toEqual([
        'Essentials',
      ]);
    });

    it('keeps the desired version across a replacement', async () => {
      await seed();
      await report([{ pluginId: 'Essentials', version: '2.19.0' }]);
      await request(s.app)
        .put(`/api/v1/fleet/servers/${serverId}/plugins/Essentials`)
        .set('Authorization', `Bearer ${access}`)
        .send({ version: '2.20.1', product: 'essentials' });

      // The report is what the server has; the desired version is the panel's
      // intent and is not the server's to overwrite.
      await report([{ pluginId: 'Essentials', version: '2.19.0' }]);

      const fetched = await request(s.app)
        .get(`/api/v1/fleet/servers/${serverId}`)
        .set('Authorization', `Bearer ${access}`);
      expect(fetched.body.plugins[0]).toMatchObject({
        installed_version: '2.19.0',
        desired_version: '2.20.1',
        drifted: true,
        state: 'pending_update',
      });
    });

    it('settles a pending update when the server reports the desired version', async () => {
      await seed();
      await report([{ pluginId: 'Essentials', version: '2.19.0' }]);
      await request(s.app)
        .put(`/api/v1/fleet/servers/${serverId}/plugins/Essentials`)
        .set('Authorization', `Bearer ${access}`)
        .send({ version: '2.20.1', product: 'essentials' });

      await report([{ pluginId: 'Essentials', version: '2.20.1' }]);

      const fetched = await request(s.app)
        .get(`/api/v1/fleet/servers/${serverId}`)
        .set('Authorization', `Bearer ${access}`);
      expect(fetched.body.plugins[0]).toMatchObject({ state: 'installed', drifted: false });
    });
  });

  describe('desired state', () => {
    it('is empty when nothing has drifted', async () => {
      await seed();
      await report([{ pluginId: 'Essentials', version: '2.19.0' }]);

      const res = await desired();
      expect(res.status).toBe(200);
      expect(res.body.actions).toEqual([]);
      expect(res.body.poll_after_seconds).toBe(300);
    });

    it('carries everything the plugin needs to act, in one payload', async () => {
      await seed();
      await report([{ pluginId: 'Essentials', version: '2.19.0' }]);
      await request(s.app)
        .put(`/api/v1/fleet/servers/${serverId}/plugins/Essentials`)
        .set('Authorization', `Bearer ${access}`)
        .send({ version: '2.20.1', product: 'essentials' });

      const res = await desired();
      expect(res.body.actions).toHaveLength(1);
      expect(res.body.actions[0]).toMatchObject({
        action: 'update',
        plugin_id: 'Essentials',
        from_version: '2.19.0',
        to_version: '2.20.1',
      });
      expect(res.body.actions[0].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.actions[0].download_url).toContain('/download');
      expect(res.body.actions[0].size_bytes).toBeGreaterThan(0);
    });

    it('calls it an install when the server does not have the plugin at all', async () => {
      await seed();
      await report([]);
      await request(s.app)
        .put(`/api/v1/fleet/servers/${serverId}/plugins/Essentials`)
        .set('Authorization', `Bearer ${access}`)
        .send({ version: '2.20.1', product: 'essentials' });

      const res = await desired();
      expect(res.body.actions[0]).toMatchObject({ action: 'install', from_version: null });
    });

    it('never tells the plugin to downgrade', async () => {
      await seed();
      await report([{ pluginId: 'Essentials', version: '2.20.1' }]);

      // A stale desired version, set before the server was upgraded by hand.
      await s.db.db
        .updateTable('server_plugins')
        .set({ desired_version: '2.19.0', product_id: productId, state: 'pending_update' })
        .where('server_id', '=', serverId)
        .execute();

      const res = await desired();
      expect(res.body.actions).toEqual([]);
    });

    it('emits a delete for a plugin marked for removal', async () => {
      await seed();
      await report([{ pluginId: 'Vault', version: '1.7.3' }]);
      await request(s.app)
        .delete(`/api/v1/fleet/servers/${serverId}/plugins/Vault`)
        .set('Authorization', `Bearer ${access}`);

      const res = await desired();
      expect(res.body.actions).toEqual([{ action: 'delete', plugin_id: 'Vault' }]);
    });

    it('skips an action whose version has been deleted from the catalogue', async () => {
      await seed();
      await report([{ pluginId: 'Essentials', version: '2.19.0' }]);
      await request(s.app)
        .put(`/api/v1/fleet/servers/${serverId}/plugins/Essentials`)
        .set('Authorization', `Bearer ${access}`)
        .send({ version: '2.20.1', product: 'essentials' });

      await request(s.app)
        .delete(`/api/v1/products/${productId}/versions/2.20.1`)
        .set('Authorization', `Bearer ${access}`);

      // Silently skipped rather than handing the plugin a download that 404s.
      const res = await desired();
      expect(res.body.actions).toEqual([]);
    });

    it('needs fleet:read, and refuses a token without it', async () => {
      await seed();
      const readOnly = await request(s.app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'artifacts only', scopes: ['artifact:read'] });

      const res = await request(s.app)
        .get(`/api/v1/fleet/servers/${serverId}/desired`)
        .set('Authorization', `Bearer ${readOnly.body.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('missing_scope');
    });
  });

  describe('reporting an outcome', () => {
    it('clears a pending delete by removing the row', async () => {
      await seed();
      await report([{ pluginId: 'Vault', version: '1.7.3' }]);
      await request(s.app)
        .delete(`/api/v1/fleet/servers/${serverId}/plugins/Vault`)
        .set('Authorization', `Bearer ${access}`);

      await request(s.app)
        .post(`/api/v1/fleet/servers/${serverId}/events`)
        .set('Authorization', `Bearer ${fleetToken}`)
        .send({ pluginId: 'Vault', state: 'installed' });

      const fetched = await request(s.app)
        .get(`/api/v1/fleet/servers/${serverId}`)
        .set('Authorization', `Bearer ${access}`);
      expect(fetched.body.plugins).toEqual([]);
    });

    it('records a failure with its reason, so the panel can show it', async () => {
      await seed();
      await report([{ pluginId: 'Essentials', version: '2.19.0' }]);

      await request(s.app)
        .post(`/api/v1/fleet/servers/${serverId}/events`)
        .set('Authorization', `Bearer ${fleetToken}`)
        .send({ pluginId: 'Essentials', state: 'failed', error: 'checksum mismatch' });

      const fetched = await request(s.app)
        .get(`/api/v1/fleet/servers/${serverId}`)
        .set('Authorization', `Bearer ${access}`);
      expect(fetched.body.plugins[0]).toMatchObject({
        state: 'failed',
        last_error: 'checksum mismatch',
      });
    });
  });

  describe('setting a desired version', () => {
    it('refuses a version that does not exist, while the form is still open', async () => {
      await seed();
      await report([{ pluginId: 'Essentials', version: '2.19.0' }]);

      const res = await request(s.app)
        .put(`/api/v1/fleet/servers/${serverId}/plugins/Essentials`)
        .set('Authorization', `Bearer ${access}`)
        .send({ version: '9.9.9', product: 'essentials' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('version_not_found');
    });

    it('refuses a version with no product to download it from', async () => {
      await seed();
      const res = await request(s.app)
        .put(`/api/v1/fleet/servers/${serverId}/plugins/Essentials`)
        .set('Authorization', `Bearer ${access}`)
        .send({ version: '2.20.1', product: null });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('product_required');
    });
  });
});
