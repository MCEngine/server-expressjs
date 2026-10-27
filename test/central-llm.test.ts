import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLlmClient, LlmError } from '../src/modules/central/brain/index.js';

/** A local stand-in for an OpenAI-compatible API, recording what it was sent. */
describe('the AI API client', () => {
  let server: Server;
  let baseUrl: string;
  const received: { path: string; auth: string; body: Record<string, unknown> }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };

  beforeEach(async () => {
    received.length = 0;
    server = createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        received.push({ path: req.url ?? '', auth: req.headers.authorization ?? '', body: JSON.parse(data) });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const call = () => ({ token: 'sk-1', baseUrl, model: 'm/x' });

  it('sends tools in the OpenAI shape and reads tool calls, citations and usage back', async () => {
    reply = {
      status: 200,
      body: {
        choices: [
          {
            message: {
              content: 'hi',
              tool_calls: [{ id: 't1', type: 'function', function: { name: 'web_search', arguments: '{"query":"q"}' } }],
              annotations: [{ type: 'url_citation', url_citation: { url: 'https://a.example', title: 'A' } }],
            },
          },
        ],
        usage: { total_tokens: 7 },
      },
    };
    const result = await createLlmClient().chat({
      ...call(),
      messages: [{ role: 'user', content: 'q' }],
      tools: [{ name: 'web_search', description: 'd', parameters: { type: 'object' } }],
      webSearch: true,
    });

    expect(received[0]).toMatchObject({ path: '/api/v1/chat/completions', auth: 'Bearer sk-1' });
    expect(received[0]!.body).toMatchObject({
      model: 'm/x',
      tools: [{ type: 'function', function: { name: 'web_search' } }],
      plugins: [{ id: 'web' }],
    });
    expect(result).toEqual({
      content: 'hi',
      toolCalls: [{ id: 't1', name: 'web_search', arguments: '{"query":"q"}' }],
      citations: [{ url: 'https://a.example', title: 'A' }],
      totalTokens: 7,
    });
  });

  it('reads an embedding', async () => {
    reply = { status: 200, body: { data: [{ embedding: [0.1, 0.2] }] } };
    expect(await createLlmClient().embed({ ...call(), input: 'x' })).toEqual([0.1, 0.2]);
    expect(received[0]).toMatchObject({ path: '/api/v1/embeddings', body: { model: 'm/x', input: 'x' } });
  });

  it("says why the API refused, in the API's own words", async () => {
    reply = { status: 401, body: { error: { message: 'No auth credentials found' } } };
    const failure = createLlmClient().chat({ ...call(), messages: [{ role: 'user', content: 'q' }] });
    await expect(failure).rejects.toBeInstanceOf(LlmError);
    await expect(failure).rejects.toThrow('No auth credentials found');
  });
});
