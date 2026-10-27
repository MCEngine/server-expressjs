import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCentral, type CentralStack } from './central-helpers.js';
import { cosine } from '../src/lib/vectors.js';

const ACCOUNT = { account_type: 'player', account_uuid: '11111111-2222-3333-4444-555555555555' };
const SERVER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const q = (params: Record<string, string | number>) =>
  '?' + new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])).toString();

describe('central routes for the plugins that had none', () => {
  let s: CentralStack;

  beforeEach(async () => {
    s = await buildCentral();
  });

  afterEach(async () => {
    await s.destroy();
  });

  describe('MCMembership', () => {
    it('saves, replaces, lists and archives memberships', async () => {
      const saved = await s.put('/api/mcmembership/memberships', {
        ...ACCOUNT,
        type: 'vip',
        ended_time: '2026-02-01T00:00:00Z',
      });
      expect(saved.body.membership).toMatchObject({ type: 'vip', ended_time: '2026-02-01T00:00:00.000Z' });

      await s.put('/api/mcmembership/memberships', { ...ACCOUNT, type: 'vip', ended_time: null }).expect(200);
      await s.put('/api/mcmembership/memberships', { ...ACCOUNT, type: 'builder', ended_time: null }).expect(200);

      const found = await s.get(`/api/mcmembership/memberships/find${q({ ...ACCOUNT, type: 'vip' })}`);
      expect(found.body.membership.ended_time).toBeNull();
      const all = await s.get(`/api/mcmembership/memberships${q(ACCOUNT)}`);
      expect(all.body.memberships.map((m: { type: string }) => m.type)).toEqual(['builder', 'vip']);

      expect((await s.post('/api/mcmembership/memberships/archive', { ...ACCOUNT, type: 'vip' })).body).toEqual({ archived: true });
      expect((await s.post('/api/mcmembership/memberships/archive', { ...ACCOUNT, type: 'vip' })).body).toEqual({ archived: false });
      expect((await s.get(`/api/mcmembership/memberships/find${q({ ...ACCOUNT, type: 'vip' })}`)).status).toBe(404);
      expect(await s.db.db.selectFrom('mcmembership_archived').selectAll().execute()).toHaveLength(1);
    });
  });

  describe('MCAgentsChat', () => {
    const id = ACCOUNT.account_uuid;

    it('keeps a session, so a player switching servers picks up the conversation', async () => {
      expect((await s.get(`/api/mcagents-chat/sessions/${id}`)).status).toBe(404);
      await s
        .put(`/api/mcagents-chat/sessions/${id}`, {
          mode: 'CHAT',
          model_id: 'openrouter/free',
          turns: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
          ],
          total_tokens: 12,
        })
        .expect(204);
      const res = await s.get(`/api/mcagents-chat/sessions/${id}`);
      expect(res.body).toMatchObject({ mode: 'CHAT', total_tokens: 12, turns: [{ role: 'user' }, { role: 'assistant' }] });

      await s.del(`/api/mcagents-chat/sessions/${id}`).expect(204);
      expect((await s.get(`/api/mcagents-chat/sessions/${id}`)).status).toBe(404);
    });

    it('is not swallowed by the MCAgents prefix it starts with', async () => {
      expect((await s.put(`/api/mcagents-chat/sessions/${id}`, { mode: 'ASK' })).status).toBe(204);
    });
  });

  describe('MCPackage', () => {
    it('records packages per server, keyed by platform and project, slashes included', async () => {
      const record = { platform: 'GitHub', project_id: 'MCPaimon/mcagents', version: '6.5.1', file_name: 'a.jar' };
      await s.put(`/api/mcpackage/servers/${SERVER}/packages`, record).expect(204);
      await s.put(`/api/mcpackage/servers/${SERVER}/packages`, { ...record, version: '6.6.0' }).expect(204);
      await s.put(`/api/mcpackage/servers/${SERVER}/packages`, { platform: 'modrinth', project_id: 'abc' }).expect(204);

      const all = (await s.get(`/api/mcpackage/servers/${SERVER}/packages`)).body.packages;
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ platform: 'github', project_id: 'MCPaimon/mcagents', version: '6.6.0', version_id: '' });

      const github = (await s.get(`/api/mcpackage/servers/${SERVER}/packages?platform=github`)).body.packages;
      expect(github).toHaveLength(1);
      const other = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
      expect((await s.get(`/api/mcpackage/servers/${other}/packages`)).body.packages).toEqual([]);
    });
  });

  describe('MCLog', () => {
    it('stores logs, embeds them, and finds the nearest by cosine similarity', async () => {
      const a = (await s.post('/api/mclog/logs', { contents: 'Steve mined diamonds' })).body;
      const b = (await s.post('/api/mclog/logs', { contents: 'Alex built a house' })).body;
      expect(a).toMatchObject({ id: 1, contents: 'Steve mined diamonds' });

      await s.put(`/api/mclog/logs/${a.id}/embeddings`, { model_name: 'Openai/Text-Embedding-3-Small', embedding: [1, 0, 0] }).expect(204);
      await s.put(`/api/mclog/logs/${b.id}/embeddings`, { model_name: 'openai/text-embedding-3-small', embedding: [0, 1, 0] }).expect(204);
      expect((await s.put('/api/mclog/logs/99/embeddings', { model_name: 'x/y', embedding: [1] })).status).toBe(404);

      const matches = (
        await s.post('/api/mclog/logs/search', { model_name: 'openai/text-embedding-3-small', embedding: [0.9, 0.1, 0], limit: 1 })
      ).body.matches;
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ id: a.id, contents: 'Steve mined diamonds' });
      expect(matches[0].similarity).toBeCloseTo(cosine([0.9, 0.1, 0], [1, 0, 0]));

      expect((await s.get('/api/mclog/logs?limit=1')).body.logs[0].id).toBe(b.id);
      expect((await s.get('/api/mclog/logs/count')).body).toEqual({ count: 2 });
    });
  });
});

describe('cosine', () => {
  it('is zero for vectors of different lengths or no direction', () => {
    expect(cosine([1, 0], [1, 0, 0])).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(cosine([2, 0], [5, 0])).toBe(1);
  });
});
