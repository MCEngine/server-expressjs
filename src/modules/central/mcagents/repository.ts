import type { Kysely, Selectable } from 'kysely';
import { insertSerial } from '../../../db/serial.js';
import type {
  Database,
  McagentsAccountsTable,
  McagentsLogsTable,
  McagentsModelsTable,
  McagentsPlatformsTable,
  McagentsPromptsTable,
  McagentsSessionsTable,
} from '../../../db/schema.js';

export type AgentPlatform = Selectable<McagentsPlatformsTable>;
export type AgentModel = Selectable<McagentsModelsTable>;
export type AgentAccount = Selectable<McagentsAccountsTable>;
export type AgentSession = Selectable<McagentsSessionsTable>;
export type AgentLog = Selectable<McagentsLogsTable>;
export type AgentPrompt = Selectable<McagentsPromptsTable>;

export interface AccountKey {
  accountType: string;
  accountUuid: string;
}

/** Every query behind MCAgents' central backend. */
export interface CentralMcagentsRepository {
  /** Returns the platform of that name, creating it if it is new. */
  ensurePlatform(displayName: string, url: string, at: string): Promise<AgentPlatform>;
  platform(id: number): Promise<AgentPlatform | undefined>;
  platforms(): Promise<AgentPlatform[]>;

  ensureModel(platformId: number, modelId: string, at: string): Promise<AgentModel>;
  models(platformId: number): Promise<AgentModel[]>;
  model(platformId: number, modelId: string): Promise<AgentModel | undefined>;

  saveAccount(key: AccountKey, platformId: number, token: string, at: string): Promise<AgentAccount>;
  account(key: AccountKey, platformId: number): Promise<AgentAccount | undefined>;
  deleteAccounts(key: AccountKey): Promise<void>;

  setSession(key: AccountKey, platformId: number, modelId: string, at: string): Promise<void>;
  session(key: AccountKey): Promise<AgentSession | undefined>;

  insertLog(
    key: AccountKey,
    entry: { platformId: number; modelId: string; chatHistory: string; tokenTotalUsage: number },
    at: string,
  ): Promise<AgentLog>;
  logs(key: AccountKey, limit: number): Promise<AgentLog[]>;

  /** Saves a prompt unless one of that id exists; either way, returns the stored one. */
  ensurePrompt(key: AccountKey, promptId: string, prompt: string, tools: string, at: string): Promise<AgentPrompt>;
  prompt(key: AccountKey, promptId: string): Promise<AgentPrompt | undefined>;
  prompts(key: AccountKey): Promise<AgentPrompt[]>;
  setPromptTools(key: AccountKey, promptId: string, tools: string, at: string): Promise<AgentPrompt | undefined>;
  deletePrompt(key: AccountKey, promptId: string): Promise<void>;
}

export function createCentralMcagentsRepository(db: Kysely<Database>): CentralMcagentsRepository {
  const findPlatformByName = (trx: Kysely<Database>, displayName: string) =>
    trx.selectFrom('mcagents_platforms').selectAll().where('display_name', '=', displayName).executeTakeFirst();

  const findModel = (trx: Kysely<Database>, platformId: number, modelId: string) =>
    trx
      .selectFrom('mcagents_models')
      .selectAll()
      .where('platform_id', '=', platformId)
      .where('model_id', '=', modelId)
      .executeTakeFirst();

  const findAccount = (trx: Kysely<Database>, key: AccountKey, platformId: number) =>
    trx
      .selectFrom('mcagents_accounts')
      .selectAll()
      .where('account_type', '=', key.accountType)
      .where('account_uuid', '=', key.accountUuid)
      .where('platform_id', '=', platformId)
      .executeTakeFirst();

  const findPrompt = (trx: Kysely<Database>, key: AccountKey, promptId: string) =>
    trx
      .selectFrom('mcagents_prompts')
      .selectAll()
      .where('account_type', '=', key.accountType)
      .where('account_uuid', '=', key.accountUuid)
      .where('prompt_id', '=', promptId)
      .executeTakeFirst();

  return {
    // Every game server on a network asks for the same platform on start, so
    // "create" is "find or create": the second server must get the first
    // one's row, not a unique-constraint failure.
    ensurePlatform: (displayName, url, at) =>
      db.transaction().execute(async (trx) => {
        const found = await findPlatformByName(trx, displayName);
        if (found !== undefined) return found;
        await trx
          .insertInto('mcagents_platforms')
          .values({ display_name: displayName, url, created_at: at, updated_at: at })
          .execute();
        return (await findPlatformByName(trx, displayName))!;
      }),

    platform: (id) => db.selectFrom('mcagents_platforms').selectAll().where('id', '=', id).executeTakeFirst(),
    platforms: () => db.selectFrom('mcagents_platforms').selectAll().orderBy('id').execute(),

    ensureModel: (platformId, modelId, at) =>
      db.transaction().execute(async (trx) => {
        const found = await findModel(trx, platformId, modelId);
        if (found !== undefined) return found;
        const row = { platform_id: platformId, model_id: modelId, created_at: at, updated_at: at };
        await trx.insertInto('mcagents_models').values(row).execute();
        return row;
      }),

    models: (platformId) =>
      db.selectFrom('mcagents_models').selectAll().where('platform_id', '=', platformId).orderBy('model_id').execute(),
    model: (platformId, modelId) => findModel(db, platformId, modelId),

    saveAccount: (key, platformId, token, at) =>
      db.transaction().execute(async (trx) => {
        const found = await findAccount(trx, key, platformId);
        if (found === undefined) {
          await trx
            .insertInto('mcagents_accounts')
            .values({
              account_type: key.accountType,
              account_uuid: key.accountUuid,
              platform_id: platformId,
              token,
              created_at: at,
              updated_at: at,
            })
            .execute();
        } else {
          await trx
            .updateTable('mcagents_accounts')
            .set({ token, updated_at: at })
            .where('account_type', '=', key.accountType)
            .where('account_uuid', '=', key.accountUuid)
            .where('platform_id', '=', platformId)
            .execute();
        }
        return (await findAccount(trx, key, platformId))!;
      }),

    account: (key, platformId) => findAccount(db, key, platformId),

    async deleteAccounts(key) {
      await db
        .deleteFrom('mcagents_accounts')
        .where('account_type', '=', key.accountType)
        .where('account_uuid', '=', key.accountUuid)
        .execute();
    },

    setSession: (key, platformId, modelId, at) =>
      db.transaction().execute(async (trx) => {
        const found = await trx
          .selectFrom('mcagents_sessions')
          .select('created_at')
          .where('account_type', '=', key.accountType)
          .where('account_uuid', '=', key.accountUuid)
          .executeTakeFirst();
        await trx
          .deleteFrom('mcagents_sessions')
          .where('account_type', '=', key.accountType)
          .where('account_uuid', '=', key.accountUuid)
          .execute();
        await trx
          .insertInto('mcagents_sessions')
          .values({
            account_type: key.accountType,
            account_uuid: key.accountUuid,
            platform_id: platformId,
            model_id: modelId,
            created_at: found?.created_at ?? at,
            updated_at: at,
          })
          .execute();
      }),

    session: (key) =>
      db
        .selectFrom('mcagents_sessions')
        .selectAll()
        .where('account_type', '=', key.accountType)
        .where('account_uuid', '=', key.accountUuid)
        .executeTakeFirst(),

    insertLog: (key, entry, at) =>
      db.transaction().execute(async (trx) => {
        const id = await insertSerial(trx, 'mcagents_logs', {
          account_type: key.accountType,
          account_uuid: key.accountUuid,
          platform_id: entry.platformId,
          model_id: entry.modelId,
          chat_history: entry.chatHistory,
          token_total_usage: entry.tokenTotalUsage,
          created_at: at,
        });
        return trx.selectFrom('mcagents_logs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      }),

    logs: (key, limit) =>
      db
        .selectFrom('mcagents_logs')
        .selectAll()
        .where('account_type', '=', key.accountType)
        .where('account_uuid', '=', key.accountUuid)
        .orderBy('id', 'desc')
        .limit(limit)
        .execute(),

    ensurePrompt: (key, promptId, prompt, tools, at) =>
      db.transaction().execute(async (trx) => {
        const found = await findPrompt(trx, key, promptId);
        if (found !== undefined) return found;
        const row = {
          account_type: key.accountType,
          account_uuid: key.accountUuid,
          prompt_id: promptId,
          prompt,
          tools,
          created_at: at,
          updated_at: at,
        };
        await trx.insertInto('mcagents_prompts').values(row).execute();
        return row;
      }),

    prompt: (key, promptId) => findPrompt(db, key, promptId),
    prompts: (key) =>
      db
        .selectFrom('mcagents_prompts')
        .selectAll()
        .where('account_type', '=', key.accountType)
        .where('account_uuid', '=', key.accountUuid)
        .orderBy('prompt_id')
        .execute(),

    setPromptTools: (key, promptId, tools, at) =>
      db.transaction().execute(async (trx) => {
        await trx
          .updateTable('mcagents_prompts')
          .set({ tools, updated_at: at })
          .where('account_type', '=', key.accountType)
          .where('account_uuid', '=', key.accountUuid)
          .where('prompt_id', '=', promptId)
          .execute();
        return findPrompt(trx, key, promptId);
      }),

    async deletePrompt(key, promptId) {
      await db
        .deleteFrom('mcagents_prompts')
        .where('account_type', '=', key.accountType)
        .where('account_uuid', '=', key.accountUuid)
        .where('prompt_id', '=', promptId)
        .execute();
    },
  };
}
