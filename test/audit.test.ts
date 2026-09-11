import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildStack, type Stack } from './auth-helpers.js';
import { bukkitJar } from './zip-builder.js';
import { createAuditService } from '../src/modules/audit/index.js';
import { fixedClock } from '../src/lib/clock.js';

const PASSWORD = 'a sufficiently long passphrase';

describe('audit log', () => {
  let s: Stack;
  let access: string;

  const registerUser = async () => {
    const res = await request(s.app).post('/api/v1/auth/register').send({
      handle: 'owner',
      displayName: 'Owner',
      email: 'owner@example.com',
      password: PASSWORD,
    });
    access = res.body.access_token as string;
    return res;
  };

  const auditRows = () => s.db.db.selectFrom('audit_events').selectAll().orderBy('id').execute();
  const fleetRows = () => s.db.db.selectFrom('fleet_events').selectAll().orderBy('id').execute();

  beforeEach(async () => {
    s = await buildStack();
  });

  afterEach(async () => {
    await s.destroy();
  });

  it('records an org being created, with who did it', async () => {
    await registerUser();
    const me = await request(s.app).get('/api/v1/me').set('Authorization', `Bearer ${access}`);

    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${access}`)
      .send({ handle: 'acme', displayName: 'Acme' });

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'org.created',
      subject_type: 'org',
      actor_account_id: me.body.id,
      actor_token_id: null,
    });
    expect(JSON.parse(rows[0]!.metadata!)).toEqual({ handle: 'acme' });
  });

  it('records which credential acted, not just which account', async () => {
    await registerUser();
    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${access}`)
      .send({ handle: 'acme', displayName: 'Acme' });

    const token = await request(s.app)
      .post('/api/v1/tokens')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'ci', scopes: ['product:write', 'artifact:write'] });

    await request(s.app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token.body.token}`)
      .send({
        slug: 'acme-tools',
        orgHandle: 'acme',
        name: 'Tools',
        summary: 'Tools.',
        kind: 'bukkit_plugin',
      });

    const rows = await auditRows();
    const created = rows.find((r) => r.action === 'product.created');
    // Knowing a CI token did this, rather than a person, is usually the point
    // of looking at all.
    expect(created!.actor_token_id).toBe(token.body.id);
    expect(created!.actor_account_id).not.toBeNull();
  });

  it('records the whole publishing story', async () => {
    await registerUser();
    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${access}`)
      .send({ handle: 'acme', displayName: 'Acme' });
    const product = await request(s.app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${access}`)
      .send({
        slug: 'acme-tools',
        orgHandle: 'acme',
        name: 'Tools',
        summary: 'Tools.',
        kind: 'bukkit_plugin',
      });
    await request(s.app)
      .put(`/api/v1/products/${product.body.id}/versions/1.0.0`)
      .set('Authorization', `Bearer ${access}`)
      .attach('file', bukkitJar(), 'Tools-1.0.0.jar');
    await request(s.app)
      .delete(`/api/v1/products/${product.body.id}`)
      .set('Authorization', `Bearer ${access}`)
      .send({ slug: 'acme-tools' });

    const actions = (await auditRows()).map((r) => r.action);
    expect(actions).toEqual([
      'org.created',
      'product.created',
      'product.version_published',
      'product.deleted',
    ]);
  });

  it('records a server’s activity separately from a person’s', async () => {
    await registerUser();
    const token = await request(s.app)
      .post('/api/v1/tokens')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'server', scopes: ['fleet:read', 'fleet:write'] });

    const server = await request(s.app)
      .post('/api/v1/fleet/servers')
      .set('Authorization', `Bearer ${token.body.token}`)
      .send({ name: 'survival' });

    await request(s.app)
      .post(`/api/v1/fleet/servers/${server.body.id}/plugins`)
      .set('Authorization', `Bearer ${token.body.token}`)
      .send({ plugins: [{ pluginId: 'Essentials', version: '2.19.0' }] });

    // Registering is something a person did; reporting an inventory is
    // something a server did. Different tables, different readers.
    expect((await auditRows()).map((r) => r.action)).toContain('server.registered');
    expect((await fleetRows()).map((r) => r.action)).toEqual(['version_check']);
  });

  it('records a failed install with its reason', async () => {
    await registerUser();
    const token = await request(s.app)
      .post('/api/v1/tokens')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'server', scopes: ['fleet:read', 'fleet:write'] });
    const server = await request(s.app)
      .post('/api/v1/fleet/servers')
      .set('Authorization', `Bearer ${token.body.token}`)
      .send({ name: 'survival' });

    await request(s.app)
      .post(`/api/v1/fleet/servers/${server.body.id}/plugins`)
      .set('Authorization', `Bearer ${token.body.token}`)
      .send({ plugins: [{ pluginId: 'Essentials', version: '2.19.0' }] });
    await request(s.app)
      .post(`/api/v1/fleet/servers/${server.body.id}/events`)
      .set('Authorization', `Bearer ${token.body.token}`)
      .send({ pluginId: 'Essentials', state: 'failed', error: 'checksum mismatch' });

    const events = await fleetRows();
    const failure = events.find((e) => e.action === 'failed');
    expect(JSON.parse(failure!.detail!)).toMatchObject({ error: 'checksum mismatch' });
  });

  it('serves an org’s trail to an admin and refuses it to a stranger', async () => {
    await registerUser();
    await request(s.app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${access}`)
      .send({ handle: 'acme', displayName: 'Acme' });

    const mine = await request(s.app)
      .get('/api/v1/orgs/acme/audit')
      .set('Authorization', `Bearer ${access}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data[0]).toMatchObject({ action: 'org.created', actor: 'user' });

    const stranger = await request(s.app).post('/api/v1/auth/register').send({
      handle: 'stranger',
      displayName: 'Stranger',
      email: 'stranger@example.com',
      password: PASSWORD,
    });
    const theirs = await request(s.app)
      .get('/api/v1/orgs/acme/audit')
      .set('Authorization', `Bearer ${stranger.body.access_token}`);
    expect(theirs.status).toBe(404);
  });

  it('never fails a request because logging failed', async () => {
    // A database with no audit table at all: every write throws.
    const broken = createAuditService(s.db.db, fixedClock('2026-01-01T00:00:00.000Z'), () => {});
    await s.db.db.schema.dropTable('audit_events').execute();

    // The point: this resolves rather than rejecting. An audit write is a side
    // effect of an action that already succeeded, and turning a logging problem
    // into a user-visible error makes the service worse than not logging.
    await expect(
      broken.record({ subjectType: 'org', subjectId: 'x', action: 'test' }),
    ).resolves.toBeUndefined();
  });

  it('reports the failure rather than swallowing it silently', async () => {
    const seen: unknown[] = [];
    const broken = createAuditService(s.db.db, fixedClock('2026-01-01T00:00:00.000Z'), (e) =>
      seen.push(e),
    );
    await s.db.db.schema.dropTable('audit_events').execute();

    await broken.record({ subjectType: 'org', subjectId: 'x', action: 'test' });
    expect(seen).toHaveLength(1);
  });
});
