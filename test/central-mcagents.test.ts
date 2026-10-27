import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCentral, type CentralStack } from './central-helpers.js';

const PLAYER = { account_type: 'player', account_uuid: '11111111-2222-3333-4444-555555555555' };
const q = (params: Record<string, string | number>) =>
  '?' + new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])).toString();

describe('central MCAgents routes', () => {
  let s: CentralStack;
  let platformId: number;

  beforeEach(async () => {
    s = await buildCentral();
    const res = await s.post('/api/mcagents/platforms', { display_name: 'openrouter', url: 'https://openrouter.ai/api/v1' });
    platformId = res.body.id;
  });

  afterEach(async () => {
    await s.destroy();
  });

  it('finds the platform a second server asks for instead of failing on its name', async () => {
    const again = await s.post('/api/mcagents/platforms', { display_name: 'openrouter', url: 'https://example.com/v1' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: platformId, url: 'https://openrouter.ai/api/v1' });
    expect((await s.get('/api/mcagents/platforms')).body).toHaveLength(1);
    expect((await s.get(`/api/mcagents/platforms/${platformId}`)).body.display_name).toBe('openrouter');
    expect((await s.get('/api/mcagents/platforms/99')).status).toBe(404);
  });

  it('registers a model once and finds it', async () => {
    await s.post('/api/mcagents/models', { platform_id: platformId, model_id: 'openrouter/free' }).expect(200);
    await s.post('/api/mcagents/models', { platform_id: platformId, model_id: 'openrouter/free' }).expect(200);
    expect((await s.get(`/api/mcagents/models${q({ platform_id: platformId })}`)).body).toHaveLength(1);
    expect(
      (await s.get(`/api/mcagents/models/find${q({ platform_id: platformId, model_id: 'openrouter/free' })}`)).status,
    ).toBe(200);
    expect((await s.get(`/api/mcagents/models/find${q({ platform_id: platformId, model_id: 'x/y' })}`)).status).toBe(404);
    expect((await s.post('/api/mcagents/models', { platform_id: 42, model_id: 'x/y' })).status).toBe(404);
  });

  it('stores, replaces and deletes an account key', async () => {
    await s.post('/api/mcagents/accounts', { ...PLAYER, platform_id: platformId, token: 'enc:1' }).expect(200);
    const replaced = await s.post('/api/mcagents/accounts', { ...PLAYER, platform_id: platformId, token: 'enc:2' });
    expect(replaced.body).toMatchObject({ ...PLAYER, platform_id: platformId, token: 'enc:2' });
    expect((await s.get(`/api/mcagents/accounts${q({ ...PLAYER, platform_id: platformId })}`)).body.token).toBe('enc:2');

    await s.del(`/api/mcagents/accounts${q(PLAYER)}`).expect(204);
    expect((await s.get(`/api/mcagents/accounts${q({ ...PLAYER, platform_id: platformId })}`)).status).toBe(404);
  });

  it('keeps one active session per account', async () => {
    expect((await s.get(`/api/mcagents/sessions${q(PLAYER)}`)).status).toBe(404);
    await s.post('/api/mcagents/sessions', { ...PLAYER, platform_id: platformId, model_id: 'a/b' }).expect(204);
    await s.post('/api/mcagents/sessions', { ...PLAYER, platform_id: platformId, model_id: 'c/d' }).expect(204);
    expect((await s.get(`/api/mcagents/sessions${q(PLAYER)}`)).body).toMatchObject({ model_id: 'c/d' });
  });

  it('numbers logs and lists them newest first', async () => {
    const log = (n: number) =>
      s.post('/api/mcagents/logs', {
        ...PLAYER,
        platform_id: platformId,
        model_id: 'a/b',
        chat_history: `turn ${n}`,
        token_total_usage: n,
      });
    expect((await log(1)).body).toMatchObject({ id: 1, chat_history: 'turn 1' });
    await log(2);
    await log(3);
    const logs = await s.get(`/api/mcagents/logs${q({ ...PLAYER, limit: 2 })}`);
    expect(logs.body.map((l: { id: number }) => l.id)).toEqual([3, 2]);
  });

  it('saves a prompt once, edits its tools, and deletes it', async () => {
    const first = await s.post('/api/mcagents/prompts', { ...PLAYER, prompt_id: 'daily', prompt: 'Say hi', tools: '' });
    expect(first.body).toMatchObject({ prompt_id: 'daily', prompt: 'Say hi', tools: '' });
    const again = await s.post('/api/mcagents/prompts', { ...PLAYER, prompt_id: 'daily', prompt: 'Other', tools: '' });
    expect(again.body.prompt).toBe('Say hi');

    const edited = await s.put('/api/mcagents/prompts/tools', { ...PLAYER, prompt_id: 'daily', tools: 'a,b' });
    expect(edited.body.tools).toBe('a,b');
    expect((await s.put('/api/mcagents/prompts/tools', { ...PLAYER, prompt_id: 'nope', tools: '' })).status).toBe(404);

    expect((await s.get(`/api/mcagents/prompts${q(PLAYER)}`)).body).toHaveLength(1);
    await s.del(`/api/mcagents/prompts${q({ ...PLAYER, prompt_id: 'daily' })}`).expect(204);
    expect((await s.get(`/api/mcagents/prompts/find${q({ ...PLAYER, prompt_id: 'daily' })}`)).status).toBe(404);
  });
});
