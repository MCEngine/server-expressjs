import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCentral, type CentralStack } from './central-helpers.js';

const PLAYER = '11111111-2222-3333-4444-555555555555';
const REALM_A = 'aaaaaaaa-1111-0000-0000-000000000001';
const REALM_B = 'bbbbbbbb-2222-0000-0000-000000000002';
const WORLD = 'cccccccc-3333-0000-0000-000000000003';
const base = '/api/mcrealm';
const pagesOf = (realm: string) => `${base}/realms/${realm}/accounts/player/${PLAYER}`;

describe('MCRealm central routes', () => {
  let s: CentralStack;

  beforeEach(async () => {
    s = await buildCentral();
    await s.put(`${base}/realm-types/global`, { display_name: 'Global' }).expect(200);
    await s.put(`${base}/realm-types/cyberpunk`, { display_name: 'Cyberpunk' }).expect(200);
  });

  afterEach(async () => {
    await s.destroy();
  });

  it('seeds realm types once and renames their display name', async () => {
    const renamed = await s.put(`${base}/realm-types/cyberpunk`, { display_name: 'Cyber Punk' }).expect(200);
    expect(renamed.body.realm_type).toMatchObject({ system_code: 'cyberpunk', display_name: 'Cyber Punk' });
    const list = await s.get(`${base}/realm-types`).expect(200);
    expect(list.body.realm_types.map((t: { system_code: string }) => t.system_code)).toEqual(['cyberpunk', 'global']);
  });

  it('creates realms with unique names and a known type', async () => {
    const res = await s
      .post(`${base}/realms`, { id: REALM_A, realm_type: 'cyberpunk', realm_name: 'season_1', display_name: 'Season 1' })
      .expect(201);
    expect(res.body.realm).toMatchObject({ id: REALM_A, realm_type: 'cyberpunk', realm_name: 'season_1', account_type: null });
    await s.post(`${base}/realms`, { realm_type: 'cyberpunk', realm_name: 'season_1', display_name: 'Again' }).expect(409);
    await s.post(`${base}/realms`, { realm_type: 'missing', realm_name: 'other', display_name: 'Other' }).expect(404);

    const edited = await s.patch(`${base}/realms/${REALM_A}`, { display_name: 'First Season' }).expect(200);
    expect(edited.body.realm.display_name).toBe('First Season');
  });

  it('gives a personal realm an owner account', async () => {
    const res = await s
      .post(`${base}/realms`, {
        realm_type: 'global',
        realm_name: 'home',
        display_name: 'Home',
        account_type: 'player',
        account_uuid: PLAYER,
      })
      .expect(201);
    expect(res.body.realm).toMatchObject({ account_type: 'player', account_uuid: PLAYER });
  });

  it('keeps pages apart per realm', async () => {
    await s.post(`${base}/realms`, { id: REALM_A, realm_type: 'global', realm_name: 'a', display_name: 'A' }).expect(201);
    await s.post(`${base}/realms`, { id: REALM_B, realm_type: 'cyberpunk', realm_name: 'b', display_name: 'B' }).expect(201);

    await s.put(`${pagesOf(REALM_A)}/inventory/1`, { contents: 'YQ==' }).expect(200);
    await s.put(`${pagesOf(REALM_A)}/equipment`, { contents: 'ZXE=' }).expect(200);
    await s.get(`${pagesOf(REALM_B)}/inventory/1`).expect(404);
    await s.get(`${pagesOf(REALM_B)}/equipment`).expect(404);

    await s.put(`${pagesOf(REALM_B)}/snapshot`, { inventory: [{ page_number: 1, contents: 'Yg==' }] }).expect(200);
    expect((await s.get(`${pagesOf(REALM_A)}/inventory/1`).expect(200)).body.page.contents).toBe('YQ==');
    expect((await s.get(`${pagesOf(REALM_B)}/inventory/1`).expect(200)).body.page.contents).toBe('Yg==');

    await s.get(`${pagesOf('dddddddd-0000-0000-0000-000000000000')}/inventory/1`).expect(404);
  });

  it('puts a world in one realm and refuses to delete a realm that still has worlds', async () => {
    await s.post(`${base}/realms`, { id: REALM_A, realm_type: 'global', realm_name: 'a', display_name: 'A' }).expect(201);
    await s.post(`${base}/realms`, { id: REALM_B, realm_type: 'global', realm_name: 'b', display_name: 'B' }).expect(201);
    await s.put(`${base}/worlds/${WORLD}`, { world_name: 'world' }).expect(200);

    await s.put(`${base}/realms/${REALM_A}/worlds/${WORLD}`).expect(204);
    await s.put(`${base}/realms/${REALM_B}/worlds/${WORLD}`).expect(204);
    expect((await s.get(`${base}/worlds/${WORLD}/realm`).expect(200)).body.realm.id).toBe(REALM_B);

    await s.del(`${base}/realms/${REALM_B}`).expect(409);
    await s.del(`${base}/realms/${REALM_B}/worlds/${WORLD}`).expect(204);
    await s.put(`${pagesOf(REALM_B)}/inventory/1`, { contents: 'Yg==' }).expect(200);
    await s.del(`${base}/realms/${REALM_B}`).expect(204);
    await s.get(`${base}/realms/${REALM_B}`).expect(404);
    await s.put(`${base}/realms/${REALM_A}/worlds/eeeeeeee-0000-0000-0000-000000000000`).expect(404);
  });

  it('shares the account and session routes with MCMultiverse', async () => {
    await s.put(`${base}/accounts/player/${PLAYER}`).expect(201);
    await s.post(`${base}/accounts/player/${PLAYER}/session`, { server_id: REALM_A }).expect(200);
    await s.post(`${base}/accounts/player/${PLAYER}/session`, { server_id: REALM_B }).expect(409);
  });
});
