import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildCentral, type CentralStack } from './central-helpers.js';

const PLAYER = '11111111-2222-3333-4444-555555555555';
const OTHER = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const story = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'The Fall of the Nether Gate',
  content: 'Steve walked through fire and came back with a legend.',
  account_type: 'player',
  account_uuid: PLAYER,
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
      account_type: 'player',
      account_uuid: PLAYER,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const again = await s.post('/api/mcstory/stories', story(id));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('story_exists');
  });

  it('lists the newest stories, and one account’s own', async () => {
    await s.post('/api/mcstory/stories', story('aaaaaaaa-0000-0000-0000-000000000001')).expect(201);
    s.at.value = new Date('2026-01-02T00:00:00.000Z');
    await s
      .post('/api/mcstory/stories', story('aaaaaaaa-0000-0000-0000-000000000002', { account_type: null, account_uuid: null, title: 'Dawn' }))
      .expect(201);
    s.at.value = new Date('2026-01-03T00:00:00.000Z');
    await s
      .post('/api/mcstory/stories', story('aaaaaaaa-0000-0000-0000-000000000003', { account_type: 'clan', account_uuid: PLAYER }))
      .expect(201);

    const recent = (await s.get('/api/mcstory/stories?limit=2').expect(200)).body.stories;
    expect(recent.map((x: { id: string }) => x.id.slice(-1))).toEqual(['3', '2']);

    const mine = (await s.get(`/api/mcstory/accounts/player/${PLAYER}/stories`).expect(200)).body.stories;
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe('aaaaaaaa-0000-0000-0000-000000000001');

    // The same UUID under another type is another account.
    const clan = (await s.get(`/api/mcstory/accounts/clan/${PLAYER}/stories`).expect(200)).body.stories;
    expect(clan.map((x: { id: string }) => x.id.slice(-1))).toEqual(['3']);
  });

  it('reads one story by id and updates it in place', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000010';
    await s.post('/api/mcstory/stories', story(id)).expect(201);
    expect((await s.get(`/api/mcstory/stories/${id}`).expect(200)).body.story.title).toBe('The Fall of the Nether Gate');

    s.at.value = new Date('2026-03-01T00:00:00.000Z');
    const edit = { title: 'The Return', content: 'He came back twice.', account_type: 'clan', account_uuid: OTHER, source: 'mcstory' };
    const updated = (await s.put(`/api/mcstory/stories/${id}`, edit).expect(200)).body.story;
    expect(updated).toMatchObject({ id, ...edit, created_at: '2026-01-01T00:00:00.000Z' });
    expect((await s.get(`/api/mcstory/stories/${id}`).expect(200)).body.story).toEqual(updated);

    const world = (await s.put(`/api/mcstory/stories/${id}`, { ...edit, account_type: null, account_uuid: null }).expect(200)).body.story;
    expect(world.account_type).toBeNull();
    expect((await s.get(`/api/mcstory/stories?limit=10`)).body.stories).toHaveLength(1);
  });

  it('answers 404 for a missing story and never creates one on update', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-000000000011';
    expect((await s.get(`/api/mcstory/stories/${id}`)).body.error.code).toBe('story_not_found');
    const edit = { title: 'X', content: 'Y', source: 'z' };
    expect((await s.put(`/api/mcstory/stories/${id}`, edit)).status).toBe(404);
    expect((await s.get('/api/mcstory/stories')).body.stories).toEqual([]);
    expect((await s.put('/api/mcstory/stories/not-a-uuid', edit)).status).toBe(400);
    await s.post('/api/mcstory/stories', story(id)).expect(201);
    expect((await s.put(`/api/mcstory/stories/${id}`, { ...edit, account_type: 'clan' })).status).toBe(400);
  });

  it('takes the account type and UUID together or not at all', async () => {
    const half = story('aaaaaaaa-0000-0000-0000-000000000008', { account_type: null });
    expect((await s.post('/api/mcstory/stories', half)).status).toBe(400);
    const badType = story('aaaaaaaa-0000-0000-0000-000000000007', { account_type: 'Clan' });
    expect((await s.post('/api/mcstory/stories', badType)).status).toBe(400);
  });

  it('refuses a story without a UUID id or with an empty body', async () => {
    expect((await s.post('/api/mcstory/stories', story('not-a-uuid'))).status).toBe(400);
    expect((await s.post('/api/mcstory/stories', story('aaaaaaaa-0000-0000-0000-000000000009', { content: ' ' }))).status).toBe(400);
  });

  it('awards an achievement once per account and lists an account’s achievements', async () => {
    const body = { title: 'Gatebreaker', description: 'Returned from the Nether alive.', source: 'minecraft' };
    const first = await s.put(`/api/mcstory/accounts/player/${PLAYER}/achievements/gatebreaker`, body).expect(201);
    expect(first.body).toMatchObject({ awarded: true, achievement: { achievement_key: 'gatebreaker' } });

    s.at.value = new Date('2026-02-01T00:00:00.000Z');
    const repeat = await s
      .put(`/api/mcstory/accounts/player/${PLAYER}/achievements/gatebreaker`, { ...body, title: 'Renamed' })
      .expect(200);
    expect(repeat.body).toMatchObject({
      awarded: false,
      achievement: { title: 'Gatebreaker', awarded_at: '2026-01-01T00:00:00.000Z' },
    });

    await s.put(`/api/mcstory/accounts/player/${PLAYER}/achievements/first_night`, body).expect(201);
    const all = (await s.get(`/api/mcstory/accounts/player/${PLAYER}/achievements`).expect(200)).body.achievements;
    expect(all.map((a: { achievement_key: string }) => a.achievement_key)).toEqual(['gatebreaker', 'first_night']);
    expect((await s.get(`/api/mcstory/accounts/player/${OTHER}/achievements`)).body.achievements).toEqual([]);

    // A clan sharing the UUID holds its own award.
    await s.put(`/api/mcstory/accounts/clan/${PLAYER}/achievements/gatebreaker`, body).expect(201);
  });

  it('refuses a malformed achievement key, account type or account UUID', async () => {
    const body = { title: 'X', description: 'Y', source: 'z' };
    expect((await s.put(`/api/mcstory/accounts/player/${PLAYER}/achievements/Bad-Key`, body)).status).toBe(400);
    expect((await s.put('/api/mcstory/accounts/player/steve/achievements/ok', body)).status).toBe(400);
    expect((await s.put(`/api/mcstory/accounts/Player/${PLAYER}/achievements/ok`, body)).status).toBe(400);
  });

  it('is behind the shared secret', async () => {
    expect((await request(s.app).get('/api/mcstory/stories')).status).toBe(401);
  });
});
