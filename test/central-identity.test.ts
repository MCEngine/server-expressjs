import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildCentral, SECRET, type CentralStack } from './central-helpers.js';

const IDENTITY = '11111111-2222-3333-4444-555555555555';
const OTHER = '66666666-7777-8888-9999-000000000000';
const PLAYER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const stats = {
  energy: 100,
  health: 20,
  food: 20,
  strength: 1,
  defense: 2,
  wisdom: 3,
  luck: 4,
  agility: 5,
  resilience: 6,
};

describe('central MCIdentity routes', () => {
  let s: CentralStack;

  const createIdentity = (uuid = IDENTITY) =>
    s.post('/v1/identities', {
      uuid,
      professionCode: 'warrior',
      properties: { level: 1, exp: 0, statPoints: 0, headText: null },
      stats,
    });

  beforeEach(async () => {
    s = await buildCentral();
    await s.post('/v1/professions', { systemCode: 'warrior', displayName: 'Warrior' }).expect(204);
  });

  afterEach(async () => {
    await s.destroy();
  });

  describe('the shared secret', () => {
    it('refuses a request without it', async () => {
      const res = await request(s.app).get('/v1/professions');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_server_token');
    });

    it('refuses a wrong one', async () => {
      const res = await request(s.app).get('/v1/professions').set('Authorization', 'Bearer nope');
      expect(res.status).toBe(401);
    });

    it('mounts nothing when the deployment has no secret', async () => {
      await s.destroy();
      s = await buildCentral({});
      const res = await request(s.app).get('/v1/professions').set('Authorization', `Bearer ${SECRET}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('route_not_found');
    });

    it('treats an empty secret as none, which is what a placeholder config sends', async () => {
      await s.destroy();
      s = await buildCentral({ SERVER_API_TOKEN: '' });
      expect((await request(s.app).get('/v1/professions').set('Authorization', 'Bearer ')).status).toBe(404);
    });
  });

  it('registers a profession once, keeping the first name', async () => {
    await s.post('/v1/professions', { systemCode: 'warrior', displayName: 'Renamed' }).expect(204);
    const res = await s.get('/v1/professions');
    expect(res.body).toEqual([{ systemCode: 'warrior', displayName: 'Warrior' }]);
  });

  it('creates an identity and reads every part of it back', async () => {
    expect((await createIdentity()).status).toBe(201);
    expect((await s.get(`/v1/identities/${IDENTITY}`)).body).toEqual({
      uuid: IDENTITY,
      professionCode: 'warrior',
    });
    expect((await s.get(`/v1/identities/${IDENTITY}/properties`)).body).toMatchObject({
      alias: null,
      level: 1,
      statPoints: 0,
    });
    expect((await s.get(`/v1/identities/${IDENTITY}/stats`)).body).toEqual(stats);
    expect((await s.get(`/v1/identities/${IDENTITY}/stats/luck`)).body).toEqual({ value: 4 });
  });

  it('refuses a second identity with the same UUID, and one with an unknown profession', async () => {
    await createIdentity();
    expect((await createIdentity()).status).toBe(409);
    const res = await s.post('/v1/identities', {
      uuid: OTHER,
      professionCode: 'nobody',
      properties: { level: 1, exp: 0, statPoints: 0 },
      stats,
    });
    expect(res.status).toBe(422);
  });

  it('answers 404 for an identity that does not exist, which the client reads as empty', async () => {
    expect((await s.get(`/v1/identities/${OTHER}/properties`)).status).toBe(404);
    expect((await s.get(`/v1/identities/not-a-uuid`)).status).toBe(400);
  });

  it('updates properties and stats, and adds to one stat atomically', async () => {
    await createIdentity();
    await s
      .put(`/v1/identities/${IDENTITY}/properties`, {
        level: 5,
        exp: 40,
        statPoints: 2,
        headText: 'head',
        inventoryContents: 'inv',
        enderchestContents: null,
      })
      .expect(204);
    await s.put(`/v1/identities/${IDENTITY}/stats`, { ...stats, luck: 10 }).expect(204);
    await s.post(`/v1/identities/${IDENTITY}/stats/luck/add`, { amount: 5 }).expect(204);

    expect((await s.get(`/v1/identities/${IDENTITY}/properties`)).body).toMatchObject({
      level: 5,
      inventoryContents: 'inv',
      enderchestContents: null,
    });
    expect((await s.get(`/v1/identities/${IDENTITY}/stats/luck`)).body).toEqual({ value: 15 });
    expect((await s.get(`/v1/identities/${IDENTITY}/stats/charm`)).status).toBe(400);
  });

  it('keeps an alias unique ignoring case, and finds by it', async () => {
    await createIdentity();
    await createIdentity(OTHER);
    await s.put(`/v1/identities/${IDENTITY}/alias`, { alias: 'Steve' }).expect(204);

    expect((await s.get('/v1/identities/alias/steve')).body).toEqual({ uuid: IDENTITY });
    expect((await s.put(`/v1/identities/${OTHER}/alias`, { alias: 'STEVE' })).status).toBe(409);

    await s.put(`/v1/identities/${IDENTITY}/alias`, { alias: null }).expect(204);
    expect((await s.get('/v1/identities/alias/steve')).status).toBe(404);
    await s.put(`/v1/identities/${OTHER}/alias`, { alias: 'STEVE' }).expect(204);
  });

  it('puts a player in one identity at a time, and takes them out on null', async () => {
    await createIdentity();
    await s.put(`/v1/players/${PLAYER}/session`, { identityUuid: IDENTITY, contentKey: 'k1' }).expect(204);
    expect((await s.get(`/v1/players/${PLAYER}/session`)).body).toEqual({
      identityUuid: IDENTITY,
      contentKey: 'k1',
    });

    await s.patch(`/v1/players/${PLAYER}/session/content-key`, { contentKey: 'k2' }).expect(204);
    expect((await s.get(`/v1/players/${PLAYER}/session`)).body.contentKey).toBe('k2');

    await s.put(`/v1/players/${PLAYER}/session`, { identityUuid: null, contentKey: null }).expect(204);
    expect((await s.get(`/v1/players/${PLAYER}/session`)).status).toBe(404);
  });

  it('moves an identity off the player who wore it before', async () => {
    await createIdentity();
    const second = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
    await s.put(`/v1/players/${PLAYER}/session`, { identityUuid: IDENTITY, contentKey: null }).expect(204);
    await s.put(`/v1/players/${second}/session`, { identityUuid: IDENTITY, contentKey: null }).expect(204);
    expect((await s.get(`/v1/players/${PLAYER}/session`)).status).toBe(404);
    expect((await s.put(`/v1/players/${PLAYER}/session`, { identityUuid: OTHER })).status).toBe(404);
  });

  it('counts base slots from zero and never below it', async () => {
    expect((await s.get(`/v1/players/${PLAYER}/base-slots`)).body).toEqual({ slots: 0 });
    expect((await s.post(`/v1/players/${PLAYER}/base-slots/add`, { amount: 3 })).body).toEqual({ slots: 3 });
    expect((await s.post(`/v1/players/${PLAYER}/base-slots/add`, { amount: -10 })).body).toEqual({ slots: 0 });
  });

  it('records an action log', async () => {
    await s.post('/v1/logs', { playerUuid: PLAYER, identityUuid: IDENTITY, actionType: 'SWAP' }).expect(204);
    const rows = await s.db.db.selectFrom('mcidentity_logs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action_type: 'SWAP', id: 1 });
  });

  describe('the add-ons', () => {
    it('keeps a skill catalogue and the skills each identity has equipped', async () => {
      await s.post('/v1/skills', { systemCode: 'dash', displayName: 'Dash', item: 'FEATHER' }).expect(204);
      expect((await s.get('/v1/skills')).body).toEqual([
        { systemCode: 'dash', displayName: 'Dash', item: 'FEATHER' },
      ]);

      await s.put(`/v1/identities/${IDENTITY}/skills/0`, { skillItem: 'dash' }).expect(204);
      await s.put(`/v1/identities/${IDENTITY}/skills/2`, { skillItem: 'leap' }).expect(204);
      expect((await s.get(`/v1/identities/${IDENTITY}/skills`)).body).toEqual({ '0': 'dash', '2': 'leap' });

      await s.put(`/v1/identities/${IDENTITY}/skills/0`, { skillItem: null }).expect(204);
      expect((await s.get(`/v1/identities/${IDENTITY}/skills`)).body).toEqual({ '2': 'leap' });
    });

    it('keeps runes in the same shape, under runeCode', async () => {
      await s.post('/v1/runes', { systemCode: 'fire', displayName: 'Fire', item: null }).expect(204);
      await s.put(`/v1/identities/${IDENTITY}/runes/1`, { runeCode: 'fire' }).expect(204);
      expect((await s.get(`/v1/identities/${IDENTITY}/runes`)).body).toEqual({ '1': 'fire' });
      expect((await s.get('/v1/runes')).body[0]).toMatchObject({ systemCode: 'fire', item: null });
    });

    it('saves the skin and the aura separately, each leaving the other alone', async () => {
      expect((await s.get(`/v1/identities/${IDENTITY}/cosmetics`)).body).toEqual({ skin: null, aura: null });
      await s.put(`/v1/identities/${IDENTITY}/cosmetics`, { skin: 'knight' }).expect(204);
      await s.put(`/v1/identities/${IDENTITY}/cosmetics`, { aura: 'flame' }).expect(204);
      expect((await s.get(`/v1/identities/${IDENTITY}/cosmetics`)).body).toEqual({ skin: 'knight', aura: 'flame' });
      await s.put(`/v1/identities/${IDENTITY}/cosmetics`, { skin: null }).expect(204);
      expect((await s.get(`/v1/identities/${IDENTITY}/cosmetics`)).body).toEqual({ skin: null, aura: 'flame' });
    });
  });

  it('leaves the liveness probe the plugins call unauthenticated', async () => {
    expect((await request(s.app).get('/health')).status).toBe(200);
  });
});
