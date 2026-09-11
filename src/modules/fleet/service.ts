import { errors } from '../../errors.js';
import { ulid } from '../../lib/ids.js';
import { iso, type Clock } from '../../lib/clock.js';
import { isNewerThan } from '../../lib/version.js';
import type { ServerPlatform, ServerPluginState } from '../../db/schema.js';
import type { ProductService } from '../product/index.js';
import type { FleetRepository, InstalledPlugin, ReportedPlugin, ServerRecord } from './repository.js';

/** A partial update to a registered server. */
export interface ServerPatch {
  name?: string | undefined;
  serverUrl?: string | null | undefined;
}

/** One thing the plugin has to do on its next pass. */
export type DesiredAction =
  | {
      action: 'install' | 'update';
      plugin_id: string;
      product_id: string;
      from_version: string | null;
      to_version: string;
      download_url: string;
      sha256: string;
      size_bytes: number;
    }
  | { action: 'delete'; plugin_id: string };

export interface DesiredState {
  readonly actions: readonly DesiredAction[];
  readonly poll_after_seconds: number;
}

/**
 * How long the plugin waits before asking again.
 *
 * Set by the server rather than by the plugin: poll interval is a property of
 * how loaded this service is, and a fleet that decides it independently cannot
 * be slowed down when it needs to be.
 */
export const DEFAULT_POLL_SECONDS = 300;

export interface FleetService {
  register(input: { ownerAccountId: string; name: string; serverUrl?: string | null }): Promise<{ server: ServerRecord; serverKey: string }>;
  requireServer(id: string, ownerAccountId: string): Promise<ServerRecord>;
  listServers(ownerAccountId: string): Promise<ServerRecord[]>;
  updateServer(id: string, ownerAccountId: string, patch: ServerPatch): Promise<ServerRecord>;
  removeServer(id: string, ownerAccountId: string): Promise<void>;

  listPlugins(serverId: string): Promise<InstalledPlugin[]>;
  reportInventory(input: {
    serverId: string;
    plugins: readonly ReportedPlugin[];
    platform?: ServerPlatform | undefined;
    mcVersion?: string | undefined;
    agentVersion?: string | undefined;
  }): Promise<void>;
  setDesiredVersion(serverId: string, pluginId: string, version: string | null, productIdOrSlug: string | null): Promise<void>;
  markForDeletion(serverId: string, pluginId: string): Promise<void>;
  reportOutcome(serverId: string, pluginId: string, state: ServerPluginState, error: string | null): Promise<void>;

  desiredState(serverId: string): Promise<DesiredState>;
}

export function createFleetService(
  repo: FleetRepository,
  products: ProductService,
  clock: Clock,
): FleetService {
  const now = () => iso(clock.now());

  const owned = async (id: string, ownerAccountId: string): Promise<ServerRecord> => {
    const server = await repo.findServer(id);
    // 404 rather than 403, so one operator cannot probe for another's servers.
    if (server === undefined || server.owner_account_id !== ownerAccountId) {
      throw errors.notFound('server_not_found', 'No such server.');
    }
    return server;
  };

  return {
    async register({ ownerAccountId, name, serverUrl }) {
      const id = ulid();
      // The identity is a generated key, not the URL. A URL is not stable, is
      // not always public, and is not exclusive to one operator.
      const serverKey = ulid();
      await repo.insertServer({
        id,
        ownerAccountId,
        serverKey,
        name,
        serverUrl: serverUrl ?? null,
        at: now(),
      });
      const server = await repo.findServer(id);
      if (server === undefined) throw errors.notFound('server_not_found', 'No such server.');
      return { server, serverKey };
    },

    requireServer: owned,
    listServers: (ownerAccountId) => repo.listServers(ownerAccountId),

    async updateServer(id, ownerAccountId, patch) {
      await owned(id, ownerAccountId);
      const columns: Record<string, unknown> = {};
      if (patch.name !== undefined) columns['name'] = patch.name;
      if (patch.serverUrl !== undefined) {
        if (patch.serverUrl !== null && (await repo.urlTakenByAnother(ownerAccountId, patch.serverUrl, id))) {
          throw errors.conflict('server_url_taken', 'Another of your servers already uses that URL.');
        }
        columns['server_url'] = patch.serverUrl;
      }
      await repo.updateServer(id, columns, now());
      return owned(id, ownerAccountId);
    },

    async removeServer(id, ownerAccountId) {
      await owned(id, ownerAccountId);
      await repo.deleteServer(id);
    },

    listPlugins: (serverId) => repo.listPlugins(serverId),

    async reportInventory({ serverId, plugins, platform, mcVersion, agentVersion }) {
      const at = now();
      const columns: Record<string, unknown> = { last_seen_at: at };
      if (platform !== undefined) columns['platform'] = platform;
      if (mcVersion !== undefined) columns['mc_version'] = mcVersion;
      if (agentVersion !== undefined) columns['agent_version'] = agentVersion;

      await repo.updateServer(serverId, columns, at);
      await repo.replaceInventory(serverId, plugins, at);
    },

    async setDesiredVersion(serverId, pluginId, version, productIdOrSlug) {
      let productId: string | null = null;
      if (productIdOrSlug !== null) {
        const product = await products.resolve(productIdOrSlug);
        productId = product.id;
        // Refusing here rather than at poll time means the panel says "no such
        // version" while the person is still looking at the form.
        if (version !== null) await products.requireVersion(product.id, version);
      }
      await repo.setDesired(serverId, pluginId, version, productId, now());
    },

    async markForDeletion(serverId, pluginId) {
      const existing = await repo.findPlugin(serverId, pluginId);
      if (existing === undefined) throw errors.notFound('plugin_not_found', 'That server does not have that plugin.');
      await repo.markForDeletion(serverId, pluginId, now());
    },

    async reportOutcome(serverId, pluginId, state, error) {
      await repo.applyOutcome(serverId, pluginId, state, error, now());
    },

    /**
     * Everything the plugin needs to act, without a second round trip.
     *
     * A row whose desired version is already installed produces no action, and
     * so does one whose desired version is not actually newer — the plugin
     * should never be told to downgrade by a stale row.
     */
    async desiredState(serverId) {
      const rows = await repo.listPlugins(serverId);
      const actions: DesiredAction[] = [];

      for (const row of rows) {
        if (row.state === 'pending_delete') {
          actions.push({ action: 'delete', plugin_id: row.plugin_id });
          continue;
        }
        if (row.desired_version === null || row.product_id === null) continue;
        if (row.desired_version === row.installed_version) continue;
        if (row.installed_version !== null && !isNewerThan(row.desired_version, row.installed_version)) {
          continue;
        }

        const product = await products.resolve(row.product_id).catch(() => undefined);
        if (product === undefined) continue;

        const version = await products
          .requireVersion(product.id, row.desired_version)
          .catch(() => undefined);
        if (version === undefined) continue;

        const file = await products.fileOf(version.id).catch(() => undefined);
        if (file === undefined) continue;

        actions.push({
          action: row.installed_version === null ? 'install' : 'update',
          plugin_id: row.plugin_id,
          product_id: product.id,
          from_version: row.installed_version,
          to_version: version.version,
          download_url: `/api/v1/products/${product.id}/versions/${encodeURIComponent(version.version)}/download`,
          sha256: file.sha256,
          size_bytes: file.size_bytes,
        });
      }

      return { actions, poll_after_seconds: DEFAULT_POLL_SECONDS };
    },
  };
}
