import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildCentral, SECRET, type CentralStack } from './central-helpers.js';

const PLAYER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER = '66666666-7777-8888-9999-000000000000';

const stats = {
  statPoints: 0,
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

  const createPlayer = (uuid = PLAYER, body = stats) => s.post('/v1/players', { playerUuid: uuid, stats: body });

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

  it('creates a player once and reads the stats back', async () => {
    expect((await createPlayer()).status).toBe(201);
    expect((await createPlayer(PLAYER, { ...stats, luck: 99 })).status).toBe(200);
    expect((await s.get(`/v1/players/${PLAYER}/stats`)).body).toEqual(stats);
    expect((await s.get(`/v1/players/${PLAYER}/stats/luck`)).body).toEqual({ value: 4 });
  });

  it('answers 404 for a player that does not exist, which the client reads as empty', async () => {
    expect((await s.get(`/v1/players/${OTHER}/stats`)).status).toBe(404);
    expect((await s.put(`/v1/players/${OTHER}/stats`, stats)).status).toBe(404);
    expect((await s.get(`/v1/players/not-a-uuid/stats`)).status).toBe(400);
  });

  it('updates stats and stat points, and adds to one stat atomically', async () => {
    await createPlayer();
    await s.put(`/v1/players/${PLAYER}/stats`, { ...stats, statPoints: 200, luck: 10 }).expect(204);
    await s.post(`/v1/players/${PLAYER}/stats/luck/add`, { amount: 5 }).expect(204);

    expect((await s.get(`/v1/players/${PLAYER}/stats`)).body).toMatchObject({ statPoints: 200, luck: 15 });
    expect((await s.get(`/v1/players/${PLAYER}/stats/charm`)).status).toBe(400);
    expect((await s.post(`/v1/players/${OTHER}/stats/luck/add`, { amount: 1 })).status).toBe(404);
  });

  it('wears one registered profession at a time', async () => {
    expect((await s.get(`/v1/players/${PLAYER}/profession`)).status).toBe(404);
    await s.put(`/v1/players/${PLAYER}/profession`, { professionCode: 'warrior' }).expect(204);
    expect((await s.get(`/v1/players/${PLAYER}/profession`)).body).toEqual({ professionCode: 'warrior' });

    await s.post('/v1/professions', { systemCode: 'player', displayName: 'Player' }).expect(204);
    await s.put(`/v1/players/${PLAYER}/profession`, { professionCode: 'player' }).expect(204);
    expect((await s.get(`/v1/players/${PLAYER}/profession`)).body).toEqual({ professionCode: 'player' });

    expect((await s.put(`/v1/players/${PLAYER}/profession`, { professionCode: 'nobody' })).status).toBe(422);
  });

  it('keeps level and EXP per profession', async () => {
    expect((await s.get(`/v1/players/${PLAYER}/professions/warrior/progress`)).status).toBe(404);
    await s.put(`/v1/players/${PLAYER}/professions/warrior/progress`, { level: 3, exp: 40 }).expect(204);
    await s.put(`/v1/players/${PLAYER}/professions/player/progress`, { level: 1, exp: 7 }).expect(204);
    await s.put(`/v1/players/${PLAYER}/professions/warrior/progress`, { level: 4, exp: 0 }).expect(204);

    expect((await s.get(`/v1/players/${PLAYER}/professions/warrior/progress`)).body).toEqual({ level: 4, exp: 0 });
    expect((await s.get(`/v1/players/${PLAYER}/professions/player/progress`)).body).toEqual({ level: 1, exp: 7 });
    expect((await s.get(`/v1/players/${OTHER}/professions/warrior/progress`)).status).toBe(404);
  });

  it('records a profession log', async () => {
    await s
      .post('/v1/profession-logs', { playerUuid: PLAYER, professionCode: 'warrior', actionType: 'EQUIP' })
      .expect(204);
    const rows = await s.db.db.selectFrom('mcidentity_profession_logs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ player_uuid: PLAYER, profession_code: 'warrior', action_type: 'EQUIP', id: 1 });
  });

  it('no longer serves the identity, session, base slot and log routes', async () => {
    expect((await s.post('/v1/identities', { uuid: OTHER })).status).toBe(404);
    expect((await s.get(`/v1/players/${PLAYER}/session`)).status).toBe(404);
    expect((await s.get(`/v1/players/${PLAYER}/base-slots`)).status).toBe(404);
    expect((await s.post('/v1/logs', {})).status).toBe(404);
  });

  describe('the add-ons', () => {
    it('keeps a skill catalogue and the skills each player has equipped', async () => {
      await s.post('/v1/skills', { systemCode: 'dash', displayName: 'Dash', item: 'FEATHER' }).expect(204);
      expect((await s.get('/v1/skills')).body).toEqual([
        { systemCode: 'dash', displayName: 'Dash', item: 'FEATHER' },
      ]);

      await s.put(`/v1/identities/${PLAYER}/skills/0`, { skillItem: 'dash' }).expect(204);
      await s.put(`/v1/identities/${PLAYER}/skills/2`, { skillItem: 'leap' }).expect(204);
      expect((await s.get(`/v1/identities/${PLAYER}/skills`)).body).toEqual({ '0': 'dash', '2': 'leap' });

      await s.put(`/v1/identities/${PLAYER}/skills/0`, { skillItem: null }).expect(204);
      expect((await s.get(`/v1/identities/${PLAYER}/skills`)).body).toEqual({ '2': 'leap' });
    });

    it('keeps runes in the same shape, under runeCode', async () => {
      await s.post('/v1/runes', { systemCode: 'fire', displayName: 'Fire', item: null }).expect(204);
      await s.put(`/v1/identities/${PLAYER}/runes/1`, { runeCode: 'fire' }).expect(204);
      expect((await s.get(`/v1/identities/${PLAYER}/runes`)).body).toEqual({ '1': 'fire' });
      expect((await s.get('/v1/runes')).body[0]).toMatchObject({ systemCode: 'fire', item: null });
    });

    it('saves the skin and the aura separately, each leaving the other alone', async () => {
      expect((await s.get(`/v1/identities/${PLAYER}/cosmetics`)).body).toEqual({ skin: null, aura: null });
      await s.put(`/v1/identities/${PLAYER}/cosmetics`, { skin: 'knight' }).expect(204);
      await s.put(`/v1/identities/${PLAYER}/cosmetics`, { aura: 'flame' }).expect(204);
      expect((await s.get(`/v1/identities/${PLAYER}/cosmetics`)).body).toEqual({ skin: 'knight', aura: 'flame' });
      await s.put(`/v1/identities/${PLAYER}/cosmetics`, { skin: null }).expect(204);
      expect((await s.get(`/v1/identities/${PLAYER}/cosmetics`)).body).toEqual({ skin: null, aura: 'flame' });
    });
  });

  it('leaves the liveness probe the plugins call unauthenticated', async () => {
    expect((await request(s.app).get('/health')).status).toBe(200);
  });
});
