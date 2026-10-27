import { afterEach, describe, expect, it } from 'vitest';
import { buildCentral, SECRET, type CentralStack } from './central-helpers.js';
import { LlmError, type ChatResult, type LlmClient } from '../src/modules/central/brain/index.js';

type ChatCall = Parameters<LlmClient['chat']>[0];

/**
 * A scripted AI API: each chat call takes the next answer, every embedding is
 * the vector `embedFor` gives the text, and every call is recorded.
 */
function fakeLlm(answers: Partial<ChatResult>[], embedFor: (text: string) => number[] = () => [1, 0]) {
  const chats: ChatCall[] = [];
  const embeds: { token: string; model: string; input: string }[] = [];
  const llm: LlmClient = {
    async chat(call) {
      chats.push(structuredClone(call));
      const next = answers.shift();
      if (next === undefined) throw new Error('no scripted answer left');
      return { content: '', toolCalls: [], citations: [], totalTokens: 10, ...next };
    },
    async embed(call) {
      embeds.push({ token: call.token, model: call.model, input: call.input });
      return embedFor(call.input);
    },
  };
  return { llm, chats, embeds };
}

describe('the central brain', () => {
  let s: CentralStack;

  afterEach(async () => {
    await s.destroy();
  });

  const ask = (body: Record<string, unknown>) => s.post('/api/mcagents/ask_global', body);

  it('answers directly when the model needs no tool, spending the caller key', async () => {
    const fake = fakeLlm([{ content: 'Forty-two.' }]);
    s = await buildCentral(undefined, { llm: fake.llm });

    const res = await ask({ question: 'What is the answer?', token: 'sk-player' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ answer: 'Forty-two.', sources: [], model: 'openrouter/free', steps: 1, total_tokens: 10 });
    expect(fake.chats[0]).toMatchObject({ token: 'sk-player', baseUrl: 'https://openrouter.ai/api/v1' });
    expect(fake.chats[0]!.tools?.map((t) => t.name)).toEqual(['search_knowledge', 'web_search']);
  });

  it('searches the knowledge pages and the network log, then answers from them', async () => {
    const fake = fakeLlm(
      [
        { toolCalls: [{ id: 'c1', name: 'search_knowledge', arguments: '{"query":"spawn rules"}' }] },
        { content: 'No griefing near spawn.' },
      ],
      (text) => (text.includes('spawn') || text.includes('Spawn') ? [1, 0] : [0, 1]),
    );
    s = await buildCentral(undefined, { llm: fake.llm });

    const page = await s.post('/api/mcagents/knowledge', {
      title: 'Spawn rules',
      content: 'No griefing within 100 blocks of spawn.',
      token: 'sk-admin',
    });
    expect(page.status).toBe(201);
    const log = (await s.post('/api/mclog/logs', { contents: 'Alex fished' })).body;
    await s.put(`/api/mclog/logs/${log.id}/embeddings`, { model_name: 'openai/text-embedding-3-small', embedding: [0, 1] });

    const res = await ask({ question: 'What are the spawn rules?', token: 'sk-player', model: 'anthropic/claude' });
    expect(res.body.answer).toBe('No griefing near spawn.');
    expect(res.body.sources).toEqual([{ type: 'knowledge', title: 'Spawn rules', ref: `knowledge:${page.body.id}` }]);
    expect(res.body.steps).toBe(2);

    // The query was embedded with the caller's key and the configured model,
    // and the tool's result went back to the model as a tool message.
    expect(fake.embeds.at(-1)).toEqual({ token: 'sk-player', model: 'openai/text-embedding-3-small', input: 'spawn rules' });
    const second = fake.chats[1]!;
    expect(second.model).toBe('anthropic/claude');
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect((second.messages.at(-1) as { content: string }).content).toContain('No griefing within 100 blocks');
  });

  it('searches the web through the model, and cites what it found', async () => {
    const fake = fakeLlm([
      { toolCalls: [{ id: 'w', name: 'web_search', arguments: '{"query":"latest minecraft version"}' }] },
      { content: 'It is 26.3.', citations: [{ url: 'https://minecraft.net/x', title: 'Minecraft' }] },
      { content: 'The latest is 26.3.' },
    ]);
    s = await buildCentral(undefined, { llm: fake.llm });

    const res = await ask({ question: 'Latest version?', token: 'sk' });
    expect(res.body.answer).toBe('The latest is 26.3.');
    expect(res.body.sources).toEqual([{ type: 'web', title: 'Minecraft', ref: 'https://minecraft.net/x' }]);
    expect(fake.chats[1]).toMatchObject({ webSearch: true });
    expect(res.body.total_tokens).toBe(30);
  });

  it('always ends in an answer: the last round offers no tools', async () => {
    const loop = { toolCalls: [{ id: 'x', name: 'web_search', arguments: '{"query":"q"}' }] };
    const fake = fakeLlm([loop, { content: 'w' }, { content: 'Done anyway.' }]);
    s = await buildCentral({ SERVER_API_TOKEN: SECRET }, { llm: fake.llm, brain: { maxSteps: 2 } });

    const res = await ask({ question: 'q', token: 'sk' });
    expect(res.body).toMatchObject({ answer: 'Done anyway.', steps: 2 });
    expect(fake.chats.at(-1)!.tools).toBeUndefined();
  });

  it('reports an AI API failure as a bad gateway, with its reason', async () => {
    const llm: LlmClient = {
      chat: async () => {
        throw new LlmError('The AI API refused the request: Invalid key', 401);
      },
      embed: async () => [],
    };
    s = await buildCentral(undefined, { llm });

    const res = await ask({ question: 'q', token: 'bad' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'ai_api_failed', message: 'The AI API refused the request: Invalid key' });
  });

  it('needs a key, and refuses an API URL it may not fetch', async () => {
    s = await buildCentral(undefined, { llm: fakeLlm([]).llm });
    expect((await ask({ question: 'q' })).status).toBe(400);
    const res = await ask({ question: 'q', token: 'sk', api_url: 'http://127.0.0.1:8080/v1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unsafe_api_url');
  });

  it('lists and deletes knowledge pages', async () => {
    s = await buildCentral(undefined, { llm: fakeLlm([]).llm });
    const page = (await s.post('/api/mcagents/knowledge', { title: 'T', content: 'C', token: 'sk' })).body;
    expect((await s.get('/api/mcagents/knowledge')).body.knowledge).toHaveLength(1);
    await s.del(`/api/mcagents/knowledge/${page.id}`).expect(204);
    expect((await s.del(`/api/mcagents/knowledge/${page.id}`)).status).toBe(404);
  });

  it('leaves the MCAgents data routes beside it working', async () => {
    s = await buildCentral(undefined, { llm: fakeLlm([]).llm });
    expect((await s.get('/api/mcagents/platforms')).status).toBe(200);
  });
});
