/**
 * The OpenAI-compatible API the brain thinks and embeds through -- OpenRouter
 * by default. An interface so a test can answer for it.
 */

export interface ToolCall {
  id: string;
  name: string;
  /** The JSON the model wrote, unparsed. */
  arguments: string;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Citation {
  url: string;
  title: string;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  /** Web pages the answer drew on, when the web plugin ran. */
  citations: Citation[];
  totalTokens: number;
}

export interface LlmCall {
  /** The caller's own key. Used for this call and never stored. */
  token: string;
  baseUrl: string;
  model: string;
}

export interface LlmClient {
  chat(call: LlmCall & { messages: ChatMessage[]; tools?: ToolDefinition[]; webSearch?: boolean }): Promise<ChatResult>;
  embed(call: LlmCall & { input: string }): Promise<number[]>;
}

/** The upstream refused or failed; the message is safe to show the caller. */
export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}

const TIMEOUT_MS = 120_000;

/**
 * The real client, over `fetch`. Redirects are refused, so the caller's key
 * only ever goes to the host that was checked.
 */
export function createLlmClient(): LlmClient {
  const post = async (call: LlmCall, path: string, body: unknown): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await fetch(`${call.baseUrl.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${call.token}`,
          'http-referer': 'https://github.com/MCEngine',
          'x-title': 'MCEngine Central',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new LlmError(`The AI API could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }

    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Left empty; the status decides below.
    }
    if (!response.ok) {
      const error = json['error'] as { message?: unknown } | undefined;
      const message = typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`;
      throw new LlmError(`The AI API refused the request: ${message}`, response.status);
    }
    return json;
  };

  return {
    async chat(call) {
      const json = await post(call, '/chat/completions', {
        model: call.model,
        messages: call.messages.map((m) =>
          m.role === 'assistant' && m.tool_calls !== undefined && m.tool_calls.length > 0
            ? {
                role: 'assistant',
                content: m.content,
                tool_calls: m.tool_calls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : m,
        ),
        ...(call.tools !== undefined && call.tools.length > 0
          ? {
              tools: call.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
        ...(call.webSearch === true ? { plugins: [{ id: 'web', max_results: 5 }] } : {}),
      });

      const choice = (json['choices'] as { message?: Record<string, unknown> }[] | undefined)?.[0];
      const message = choice?.message ?? {};
      const rawCalls = (message['tool_calls'] as { id?: string; function?: { name?: string; arguments?: string } }[] | undefined) ?? [];
      const annotations = (message['annotations'] as { url_citation?: { url?: string; title?: string } }[] | undefined) ?? [];
      const usage = json['usage'] as { total_tokens?: number } | undefined;

      return {
        content: typeof message['content'] === 'string' ? message['content'] : '',
        toolCalls: rawCalls
          .filter((c) => typeof c.function?.name === 'string')
          .map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.function!.name!, arguments: c.function?.arguments ?? '{}' })),
        citations: annotations
          .map((a) => a.url_citation)
          .filter((c): c is { url: string; title?: string } => typeof c?.url === 'string')
          .map((c) => ({ url: c.url, title: c.title ?? c.url })),
        totalTokens: typeof usage?.total_tokens === 'number' ? usage.total_tokens : 0,
      };
    },

    async embed(call) {
      const json = await post(call, '/embeddings', { model: call.model, input: call.input });
      const vector = (json['data'] as { embedding?: unknown }[] | undefined)?.[0]?.embedding;
      if (!Array.isArray(vector) || !vector.every((n) => typeof n === 'number')) {
        throw new LlmError('The AI API returned no embedding.');
      }
      return vector as number[];
    },
  };
}
