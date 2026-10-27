import { errors } from '../../../errors.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { assertFetchable, UnsafeUrlError } from '../../../lib/net.js';
import type { CentralLogRepository } from '../mclog/index.js';
import type { KnowledgeEntry, KnowledgeRepository } from './knowledge.js';
import { LlmError, type ChatMessage, type LlmCall, type LlmClient, type ToolDefinition } from './llm.js';

export interface BrainSettings {
  /** The model that thinks, unless the question names one. */
  agentModel: string;
  /** The model searches are embedded with; stored embeddings must match it. */
  embeddingModel: string;
  /** The OpenAI-compatible API, unless the question names another. */
  apiUrl: string;
  /** Tool rounds one question may take before it must answer. */
  maxSteps: number;
}

export interface Source {
  type: 'knowledge' | 'log' | 'web';
  title: string;
  /** A URL for the web, `knowledge:<id>` or `log:<id>` otherwise. */
  ref: string;
}

export interface Answer {
  answer: string;
  sources: Source[];
  model: string;
  steps: number;
  total_tokens: number;
}

export interface AskInput {
  question: string;
  token: string;
  model?: string | undefined;
  apiUrl?: string | undefined;
}

/**
 * The central brain: an agent of its own, separate from the one each game
 * server runs, that answers what needs the whole network or the web.
 *
 * It has two tools. `search_knowledge` embeds the query and ranks the
 * operator's knowledge pages and MCLog's network-wide log by similarity.
 * `web_search` asks the model again with OpenRouter's web plugin on. The
 * caller's key pays for every call and is never stored.
 */
export interface BrainService {
  ask(input: AskInput): Promise<Answer>;
  addKnowledge(input: { title: string; content: string; source: string | null; token: string; apiUrl?: string | undefined }): Promise<KnowledgeEntry>;
}

const SYSTEM_PROMPT = [
  'You are the central brain of a Minecraft server network. Another AI agent, running on one game server,',
  'has handed you a question it cannot answer from that server alone.',
  'Use search_knowledge for anything about this network: its rules, guides and lore, and what has happened',
  'on any of its servers. Use web_search for anything about the outside world, Minecraft itself, or plugins.',
  'Call tools only when they help. Answer in plain text, concisely, and say when you found nothing.',
].join(' ');

const TOOLS: ToolDefinition[] = [
  {
    name: 'search_knowledge',
    description:
      "Search the network's knowledge pages and the log of what happened on every server, by meaning. Returns the closest matches.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in plain words.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'How many matches to return. Default 5.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web and get a summary with sources.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query.' } },
      required: ['query'],
    },
  },
];

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function createBrainService(
  llm: LlmClient,
  knowledge: KnowledgeRepository,
  logs: CentralLogRepository,
  settings: BrainSettings,
  clock: Clock,
): BrainService {
  /**
   * The caller may point the brain at its own OpenAI-compatible API, since
   * the key it sends belongs to that API. Anything but the configured URL is
   * checked first: this server would otherwise fetch wherever it is told.
   */
  const resolveApiUrl = async (requested: string | undefined): Promise<string> => {
    if (requested === undefined || requested.replace(/\/+$/, '') === settings.apiUrl.replace(/\/+$/, '')) {
      return settings.apiUrl;
    }
    try {
      return (await assertFetchable(requested)).toString().replace(/\/+$/, '');
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw errors.badRequest('unsafe_api_url', error.message);
      throw error;
    }
  };

  const upstream = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof LlmError) throw errors.badGateway('ai_api_failed', error.message);
      throw error;
    }
  };

  const searchKnowledge = async (call: LlmCall, query: string, limit: number, sources: Source[]): Promise<string> => {
    const vector = await upstream(() => llmEmbed(call, query));
    const [pages, entries] = await Promise.all([
      knowledge.search(settings.embeddingModel, vector, limit),
      logs.search(settings.embeddingModel, vector, limit),
    ]);
    const ranked = [
      ...pages.map((p) => ({ similarity: p.similarity, source: { type: 'knowledge' as const, title: p.title, ref: `knowledge:${p.id}` }, text: `[knowledge:${p.id}] ${p.title}\n${clip(p.content, 2000)}` })),
      ...entries.map((e) => ({ similarity: e.similarity, source: { type: 'log' as const, title: clip(e.contents, 80), ref: `log:${e.id}` }, text: `[log:${e.id} at ${e.created_at}] ${clip(e.contents, 1000)}` })),
    ]
      .filter((r) => r.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    if (ranked.length === 0) return 'Nothing in the knowledge pages or the network log matches.';
    for (const r of ranked) sources.push(r.source);
    return ranked.map((r) => r.text).join('\n\n');
  };

  const llmEmbed = (call: LlmCall, input: string) => llm.embed({ ...call, model: settings.embeddingModel, input });

  const webSearch = async (call: LlmCall, query: string, sources: Source[]): Promise<{ text: string; tokens: number }> => {
    const result = await upstream(() =>
      llm.chat({ ...call, webSearch: true, messages: [{ role: 'user', content: query }] }),
    );
    for (const c of result.citations) sources.push({ type: 'web', title: c.title, ref: c.url });
    const cited = result.citations.map((c) => `- ${c.title}: ${c.url}`).join('\n');
    return { text: cited === '' ? result.content : `${result.content}\n\nSources:\n${cited}`, tokens: result.totalTokens };
  };

  return {
    async ask({ question, token, model, apiUrl }) {
      const call: LlmCall = { token, baseUrl: await resolveApiUrl(apiUrl), model: model ?? settings.agentModel };
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question },
      ];
      const sources: Source[] = [];
      let totalTokens = 0;

      for (let step = 1; step <= settings.maxSteps; step += 1) {
        // The last round offers no tools, so the loop always ends in an answer.
        const offerTools = step < settings.maxSteps;
        const result = await upstream(() => llm.chat({ ...call, messages, ...(offerTools ? { tools: TOOLS } : {}) }));
        totalTokens += result.totalTokens;

        if (!offerTools || result.toolCalls.length === 0) {
          return { answer: result.content, sources: dedupe(sources), model: call.model, steps: step, total_tokens: totalTokens };
        }

        messages.push({ role: 'assistant', content: result.content === '' ? null : result.content, tool_calls: result.toolCalls });
        for (const toolCall of result.toolCalls) {
          let args: { query?: unknown; limit?: unknown } = {};
          try {
            args = JSON.parse(toolCall.arguments) as typeof args;
          } catch {
            // Answered below as a missing query.
          }
          const query = typeof args.query === 'string' ? args.query.trim() : '';
          let content: string;
          if (query === '') {
            content = 'The tool needs a non-empty "query".';
          } else if (toolCall.name === 'search_knowledge') {
            const limit = typeof args.limit === 'number' ? Math.min(10, Math.max(1, Math.trunc(args.limit))) : 5;
            content = await searchKnowledge(call, query, limit, sources);
          } else if (toolCall.name === 'web_search') {
            const found = await webSearch(call, query, sources);
            totalTokens += found.tokens;
            content = found.text;
          } else {
            content = `There is no tool named ${toolCall.name}.`;
          }
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content });
        }
      }
      // Unreachable: the last step never offers tools.
      throw new Error('The brain ran out of steps without answering.');
    },

    async addKnowledge({ title, content, source, token, apiUrl }) {
      const call: LlmCall = { token, baseUrl: await resolveApiUrl(apiUrl), model: settings.embeddingModel };
      const vector = await upstream(() => llmEmbed(call, `${title}\n\n${content}`));
      return knowledge.add({ title, content, source }, settings.embeddingModel, vector, iso(clock.now()));
    },
  };
}

function dedupe(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => (seen.has(s.ref) ? false : (seen.add(s.ref), true)));
}
