import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildCentral, type CentralStack } from './central-helpers.js';

const PLAYER = '11111111-2222-3333-4444-555555555555';
const OTHER = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const story = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'The Fall of the Nether Gate',
  content: 'Steve walked through fire and came back with a legend.',
  player_uuid: PLAYER,
  source: 'minecraft',
  ...extra,
});

describe('MCStory central routes', () => {
  let s: CentralStack;

  beforeEach(async () => {
    s = await buildCentral();
  });

  afterEach(async () => {
    await s.destroy();
  });

  it('archives a story once and stamps it with the server clock', async () => {
    const id = 'AAAAAAAA-0000-0000-0000-000000000001';
    const res = await s.post('/api/mcstory/stories', story(id)).expect(201);
    expect(res.body.story).toMatchObject({
      id: id.toLowerCase(),
      player_uuid: PLAYER,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const again = await s.post('/api/mcstory/stories', story(id));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('story_exists');
  });

  it('lists the newest stories, and a player’s own', async () => {
    await s.post('/api/mcstory/stories', story('aaaaaaaa-0000-0000-0000-000000000001')).expect(201);
    s.at.value = new Date('2026-01-02T00:00:00.000Z');
    await s
      .post('/api/mcstory/stories', story('aaaaaaaa-0000-0000-0000-000000000002', { player_uuid: null, title: 'Dawn' }))
      .expect(201);
    s.at.value = new Date('2026-01-03T00:00:00.000Z');
    await s
      .post('/api/mcstory/stories', story('aaaaaaaa-0000-0000-0000-000000000003', { player_uuid: OTHER }))
      .expect(201);

    const recent = (await s.get('/api/mcstory/stories?limit=2').expect(200)).body.stories;
    expect(recent.map((x: { id: string }) => x.id.slice(-1))).toEqual(['3', '2']);

    const mine = (await s.get(`/api/mcstory/players/${PLAYER}/stories`).expect(200)).body.stories;
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe('aaaaaaaa-0000-0000-0000-000000000001');
  });

  it('refuses a story without a UUID id or with an empty body', async () => {
    expect((await s.post('/api/mcstory/stories', story('not-a-uuid'))).status).toBe(400);
    expect((await s.post('/api/mcstory/stories', story('aaaaaaaa-0000-0000-0000-000000000009', { content: ' ' }))).status).toBe(400);
  });

  it('awards an achievement once and lists a player’s achievements', async () => {
    const body = { title: 'Gatebreaker', description: 'Returned from the Nether alive.', source: 'minecraft' };
    const first = await s.put(`/api/mcstory/players/${PLAYER}/achievements/gatebreaker`, body).expect(201);
    expect(first.body).toMatchObject({ awarded: true, achievement: { achievement_key: 'gatebreaker' } });

    s.at.value = new Date('2026-02-01T00:00:00.000Z');
    const repeat = await s
      .put(`/api/mcstory/players/${PLAYER}/achievements/gatebreaker`, { ...body, title: 'Renamed' })
      .expect(200);
    expect(repeat.body).toMatchObject({
      awarded: false,
      achievement: { title: 'Gatebreaker', awarded_at: '2026-01-01T00:00:00.000Z' },
    });

    await s.put(`/api/mcstory/players/${PLAYER}/achievements/first_night`, body).expect(201);
    const all = (await s.get(`/api/mcstory/players/${PLAYER}/achievements`).expect(200)).body.achievements;
    expect(all.map((a: { achievement_key: string }) => a.achievement_key)).toEqual(['gatebreaker', 'first_night']);
    expect((await s.get(`/api/mcstory/players/${OTHER}/achievements`)).body.achievements).toEqual([]);
  });

  it('refuses a malformed achievement key or player', async () => {
    const body = { title: 'X', description: 'Y', source: 'z' };
    expect((await s.put(`/api/mcstory/players/${PLAYER}/achievements/Bad-Key`, body)).status).toBe(400);
    expect((await s.put('/api/mcstory/players/steve/achievements/ok', body)).status).toBe(400);
  });

  it('is behind the shared secret', async () => {
    expect((await request(s.app).get('/api/mcstory/stories')).status).toBe(401);
  });
});
