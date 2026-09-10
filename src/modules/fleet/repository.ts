import type { Kysely } from 'kysely';
import type { Database, ServerPlatform, ServerPluginState } from '../../db/schema.js';

export interface ServerRecord {
  id: string;
  owner_account_id: string;
  server_key: string;
  server_url: string | null;
  name: string;
  platform: ServerPlatform | null;
  mc_version: string | null;
  agent_version: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstalledPlugin {
  server_id: string;
  plugin_id: string;
  product_id: string | null;
  installed_version: string | null;
  installed_sha256: string | null;
  desired_version: string | null;
  state: ServerPluginState;
  last_error: string | null;
  updated_at: string;
}

/**
 * One plugin as a Minecraft server reports it.
 *
 * The optional properties spell `undefined` out because a caller builds this
 * from parsed JSON, where an omitted key is present-and-undefined rather than
 * missing.
 */
export interface ReportedPlugin {
  pluginId: string;
  version: string | null;
  sha256?: string | null | undefined;
  productId?: string | null | undefined;
}

export interface FleetRepository {
  insertServer(input: {
    id: string;
    ownerAccountId: string;
    serverKey: string;
    name: string;
    serverUrl: string | null;
    at: string;
  }): Promise<void>;
  findServer(id: string): Promise<ServerRecord | undefined>;
  findServerByKey(key: string): Promise<ServerRecord | undefined>;
  listServers(ownerAccountId: string): Promise<ServerRecord[]>;
  urlTakenByAnother(ownerAccountId: string, url: string, exceptId: string): Promise<boolean>;
  updateServer(id: string, patch: Record<string, unknown>, at: string): Promise<void>;
  deleteServer(id: string): Promise<void>;

  listPlugins(serverId: string): Promise<InstalledPlugin[]>;
  findPlugin(serverId: string, pluginId: string): Promise<InstalledPlugin | undefined>;
  replaceInventory(serverId: string, reported: readonly ReportedPlugin[], at: string): Promise<void>;
  setDesired(serverId: string, pluginId: string, desired: string | null, productId: string | null, at: string): Promise<void>;
  markForDeletion(serverId: string, pluginId: string, at: string): Promise<void>;
  applyOutcome(serverId: string, pluginId: string, state: ServerPluginState, error: string | null, at: string): Promise<void>;
}

const SERVER_COLUMNS = [
  'id', 'owner_account_id', 'server_key', 'server_url', 'name', 'platform', 'mc_version',
  'agent_version', 'last_seen_at', 'created_at', 'updated_at',
] as const;

const PLUGIN_COLUMNS = [
  'server_id', 'plugin_id', 'product_id', 'installed_version', 'installed_sha256',
  'desired_version', 'state', 'last_error', 'updated_at',
] as const;

export function createFleetRepository(db: Kysely<Database>): FleetRepository {
  return {
    async insertServer({ id, ownerAccountId, serverKey, name, serverUrl, at }) {
      await db
        .insertInto('minecraft_servers')
        .values({
          id,
          owner_account_id: ownerAccountId,
          server_key: serverKey,
          server_url: serverUrl,
          name,
          platform: null,
          mc_version: null,
          agent_version: null,
          last_seen_at: null,
          created_at: at,
          updated_at: at,
        })
        .execute();
    },

    async findServer(id) {
      return (await db
        .selectFrom('minecraft_servers')
        .select(SERVER_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst()) as ServerRecord | undefined;
    },

    async findServerByKey(key) {
      return (await db
        .selectFrom('minecraft_servers')
        .select(SERVER_COLUMNS)
        .where('server_key', '=', key)
        .executeTakeFirst()) as ServerRecord | undefined;
    },

    async listServers(ownerAccountId) {
      return (await db
        .selectFrom('minecraft_servers')
        .select(SERVER_COLUMNS)
        .where('owner_account_id', '=', ownerAccountId)
        .orderBy('created_at')
        .execute()) as ServerRecord[];
    },

    async urlTakenByAnother(ownerAccountId, url, exceptId) {
      // Unique per owner, not globally: two operators can legitimately run
      // behind the same hostname.
      const row = await db
        .selectFrom('minecraft_servers')
        .select('id')
        .where('owner_account_id', '=', ownerAccountId)
        .where('server_url', '=', url)
        .where('id', '!=', exceptId)
        .executeTakeFirst();
      return row !== undefined;
    },

    async updateServer(id, patch, at) {
      await db
        .updateTable('minecraft_servers')
        .set({ ...patch, updated_at: at } as never)
        .where('id', '=', id)
        .execute();
    },

    async deleteServer(id) {
      await db.deleteFrom('minecraft_servers').where('id', '=', id).execute();
    },

    async listPlugins(serverId) {
      return (await db
        .selectFrom('server_plugins')
        .select(PLUGIN_COLUMNS)
        .where('server_id', '=', serverId)
        .orderBy('plugin_id')
        .execute()) as InstalledPlugin[];
    },

    async findPlugin(serverId, pluginId) {
      return (await db
        .selectFrom('server_plugins')
        .select(PLUGIN_COLUMNS)
        .where('server_id', '=', serverId)
        .where('plugin_id', '=', pluginId)
        .executeTakeFirst()) as InstalledPlugin | undefined;
    },

    /**
     * Replaces the whole inventory for a server.
     *
     * A full replacement, not a patch: a plugin removed by hand on the server
     * disappears from the report, and a patch would leave it in the table
     * forever. The desired version is deliberately preserved across the
     * replacement — it is the panel's intent, not something the server reports.
     */
    async replaceInventory(serverId, reported, at) {
      await db.transaction().execute(async (trx) => {
        const existing = (await trx
          .selectFrom('server_plugins')
          .select(['plugin_id', 'desired_version', 'product_id', 'state'])
          .where('server_id', '=', serverId)
          .execute()) as {
          plugin_id: string;
          desired_version: string | null;
          product_id: string | null;
          state: ServerPluginState;
        }[];
        const previous = new Map(existing.map((row) => [row.plugin_id, row]));

        await trx.deleteFrom('server_plugins').where('server_id', '=', serverId).execute();
        if (reported.length === 0) return;

        await trx
          .insertInto('server_plugins')
          .values(
            reported.map((plugin) => {
              const before = previous.get(plugin.pluginId);
              const desired = before?.desired_version ?? null;
              const settled = desired === null || desired === plugin.version;
              return {
                server_id: serverId,
                plugin_id: plugin.pluginId,
                product_id: plugin.productId ?? before?.product_id ?? null,
                installed_version: plugin.version,
                installed_sha256: plugin.sha256 ?? null,
                desired_version: desired,
                // Reporting the desired version as installed is what closes a
                // pending update -- the server did the work.
                state: settled ? ('installed' as const) : ('pending_update' as const),
                last_error: null,
                created_at: at,
                updated_at: at,
              };
            }),
          )
          .execute();
      });
    },

    async setDesired(serverId, pluginId, desired, productId, at) {
      const existing = await this.findPlugin(serverId, pluginId);
      if (existing === undefined) {
        // Installing something the server does not have yet: the row exists
        // with no installed version, which is exactly what makes it an install
        // rather than an update.
        await db
          .insertInto('server_plugins')
          .values({
            server_id: serverId,
            plugin_id: pluginId,
            product_id: productId,
            installed_version: null,
            installed_sha256: null,
            desired_version: desired,
            state: 'pending_update',
            last_error: null,
            created_at: at,
            updated_at: at,
          })
          .execute();
        return;
      }

      const settled = desired === null || desired === existing.installed_version;
      await db
        .updateTable('server_plugins')
        .set({
          desired_version: desired,
          product_id: productId ?? existing.product_id,
          state: settled ? 'installed' : 'pending_update',
          updated_at: at,
        })
        .where('server_id', '=', serverId)
        .where('plugin_id', '=', pluginId)
        .execute();
    },

    async markForDeletion(serverId, pluginId, at) {
      await db
        .updateTable('server_plugins')
        .set({ state: 'pending_delete', desired_version: null, updated_at: at })
        .where('server_id', '=', serverId)
        .where('plugin_id', '=', pluginId)
        .execute();
    },

    async applyOutcome(serverId, pluginId, state, error, at) {
      if (state === 'installed' && error === null) {
        const row = await this.findPlugin(serverId, pluginId);
        if (row?.state === 'pending_delete') {
          await db
            .deleteFrom('server_plugins')
            .where('server_id', '=', serverId)
            .where('plugin_id', '=', pluginId)
            .execute();
          return;
        }
      }

      await db
        .updateTable('server_plugins')
        .set({ state, last_error: error, updated_at: at })
        .where('server_id', '=', serverId)
        .where('plugin_id', '=', pluginId)
        .execute();
    },
  };
}
