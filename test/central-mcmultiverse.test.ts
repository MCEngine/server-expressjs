import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildCentral, type CentralStack } from './central-helpers.js';

const PLAYER = '11111111-2222-3333-4444-555555555555';
const SERVER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SERVER_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const WORLD = 'cccccccc-0000-0000-0000-000000000003';
const base = '/api/mcmultiverse';
const account = `${base}/accounts/player/${PLAYER}`;

describe('MCMultiverse central routes', () => {
  let s: CentralStack;

  beforeEach(async () => {
    s = await buildCentral();
  });

  afterEach(async () => {
    await s.destroy();
  });

  it('refuses a request without the server token', async () => {
    await request(s.app).get(`${base}/worlds`).expect(401);
  });

  it('creates an account once with one page of each kind', async () => {
    const first = await s.put(account).expect(201);
    expect(first.body.account).toMatchObject({
      account_type: 'player',
      account_uuid: PLAYER,
      inventory_page_limit: 1,
      enderchest_page_limit: 1,
    });
    await s.put(account).expect(200);
    await s.get(`${base}/accounts/player/${'9'.repeat(8)}-2222-3333-4444-555555555555`).expect(404);
  });

  it('raises page limits and refuses a limit below one', async () => {
    await s.put(account).expect(201);
    const res = await s.patch(`${account}/property`, { inventory_page_limit: 3 }).expect(200);
    expect(res.body.account).toMatchObject({ inventory_page_limit: 3, enderchest_page_limit: 1 });
    await s.patch(`${account}/property`, { enderchest_page_limit: 0 }).expect(400);
    await s.patch(`${account}/property`, {}).expect(400);
  });

  it('gives a session to one server at a time and lets a stale lock be taken over', async () => {
    await s.post(`${account}/session`, { server_id: SERVER_A }).expect(200);
    await s.post(`${account}/session`, { server_id: SERVER_A }).expect(200);
    const held = await s.post(`${account}/session`, { server_id: SERVER_B, stale_seconds: 30 }).expect(409);
    expect(held.body.error.code).toBe('session_held');

    s.at.value = new Date('2026-01-01T00:00:31.000Z');
    await s.post(`${account}/session`, { server_id: SERVER_B, stale_seconds: 30 }).expect(200);

    const notOurs = await s.del(`${account}/session`).send({ server_id: SERVER_A }).expect(200);
    expect(notOurs.body.released).toBe(false);
    const ours = await s.del(`${account}/session`).send({ server_id: SERVER_B }).expect(200);
    expect(ours.body.released).toBe(true);
  });

  it('stores inventory and ender chest pages apart, page by page', async () => {
    await s.put(`${account}/inventory/1`, { contents: 'aW52MQ==' }).expect(200);
    await s.put(`${account}/inventory/2`, { contents: 'aW52Mg==' }).expect(200);
    await s.put(`${account}/enderchest/1`, { contents: 'ZW5kMQ==' }).expect(200);
    await s.put(`${account}/inventory/1`, { contents: 'aW52MWI=' }).expect(200);

    const pages = await s.get(`${account}/inventory`).expect(200);
    expect(pages.body.pages.map((p: { page_number: number; contents: string }) => [p.page_number, p.contents])).toEqual([
      [1, 'aW52MWI='],
      [2, 'aW52Mg=='],
    ]);
    const ender = await s.get(`${account}/enderchest/1`).expect(200);
    expect(ender.body.page.contents).toBe('ZW5kMQ==');
    await s.get(`${account}/enderchest/2`).expect(404);
    await s.put(`${account}/inventory/0`, { contents: 'eA==' }).expect(400);
    await s.put(`${account}/inventory/1`, { contents: '' }).expect(400);
  });

  it('saves a whole snapshot and releases the lock in one request', async () => {
    await s.post(`${account}/session`, { server_id: SERVER_A }).expect(200);
    await s
      .put(`${account}/snapshot`, {
        inventory: [
          { page_number: 1, contents: 'cDE=' },
          { page_number: 2, contents: 'cDI=' },
        ],
        equipment: 'ZXF1aXA=',
        enderchest: [{ page_number: 1, contents: 'ZTE=' }],
        release_session: { server_id: SERVER_A },
      })
      .expect(200);

    expect((await s.get(`${account}/equipment`).expect(200)).body.equipment.contents).toBe('ZXF1aXA=');
    expect((await s.get(`${account}/inventory`).expect(200)).body.pages).toHaveLength(2);
    await s.post(`${account}/session`, { server_id: SERVER_B }).expect(200);
  });

  it('accepts a snapshot larger than the general 1 MB body limit', async () => {
    const big = 'A'.repeat(1_500_000);
    await s.put(`${account}/snapshot`, { inventory: [{ page_number: 1, contents: big }] }).expect(200);
    expect((await s.get(`${account}/inventory/1`).expect(200)).body.page.contents).toHaveLength(big.length);
  });

  it('registers worlds by unique name and stores chest blocks per position', async () => {
    const world = await s.put(`${base}/worlds/${WORLD}`, { world_name: 'farm', environment: 'normal' }).expect(200);
    expect(world.body.world).toMatchObject({ id: WORLD, world_name: 'farm', account_type: null });
    await s.put(`${base}/worlds/dddddddd-0000-0000-0000-000000000004`, { world_name: 'farm' }).expect(409);
    expect((await s.get(`${base}/worlds/by-name/farm`).expect(200)).body.world.id).toBe(WORLD);

    await s.put(`${base}/worlds/${WORLD}/chests/10/64/-5`, { contents: 'bGVmdA==' }).expect(200);
    await s.put(`${base}/worlds/${WORLD}/chests/11/64/-5`, { contents: 'cmlnaHQ=' }).expect(200);
    await s.del(`${base}/worlds/${WORLD}/chests/10/64/-5`).expect(204);
    await s.get(`${base}/worlds/${WORLD}/chests/10/64/-5`).expect(404);
    expect((await s.get(`${base}/worlds/${WORLD}/chests/11/64/-5`).expect(200)).body.chest.contents).toBe('cmlnaHQ=');

    await s.del(`${base}/worlds/${WORLD}`).expect(204);
    await s.get(`${base}/worlds/${WORLD}/chests/11/64/-5`).expect(404);
  });

  it('gives a world an owner account', async () => {
    const res = await s
      .put(`${base}/worlds/${WORLD}`, { world_name: 'home', account_type: 'player', account_uuid: PLAYER })
      .expect(200);
    expect(res.body.world).toMatchObject({ account_type: 'player', account_uuid: PLAYER });
    await s.put(`${base}/worlds/${WORLD}`, { world_name: 'home', account_type: 'player' }).expect(400);
  });
});
