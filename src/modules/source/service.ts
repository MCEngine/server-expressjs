import { createHash } from 'node:crypto';
import { errors } from '../../errors.js';
import { ulid } from '../../lib/ids.js';
import { iso, type Clock } from '../../lib/clock.js';
import { assertFetchable, UnsafeUrlError } from '../../lib/net.js';
import { inspectJar, safeFileName } from '../product/jar.js';
import { resolveReference } from './resolvers.js';
import type { Kysely } from 'kysely';
import type { Database, ProductKind, SourceType } from '../../db/schema.js';
import type { Storage } from '../../storage/index.js';

/** How the service reaches the internet. Injected so a test never does. */
export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface MirroredArtifact {
  readonly id: string;
  readonly source_type: SourceType;
  readonly source_ref: string;
  readonly file_name: string;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly download_url: string;
}

export interface SourceService {
  resolve(input: {
    sourceType: SourceType;
    sourceRef: string;
    kind: ProductKind;
    serverId?: string | null;
    maxBytes: number;
  }): Promise<MirroredArtifact>;
  find(id: string): Promise<MirroredArtifact | undefined>;
  open(id: string): Promise<{ artifact: MirroredArtifact; key: string }>;
}

const FETCH_TIMEOUT_MS = 30_000;

export function createSourceService(
  db: Kysely<Database>,
  storage: Storage,
  clock: Clock,
  fetcher: Fetcher = globalThis.fetch as unknown as Fetcher,
): SourceService {
  const now = () => iso(clock.now());
  const mirrors = new Map<string, { key: string; artifact: MirroredArtifact }>();

  return {
    /**
     * Fetches the referenced artifact, validates it, stores it, and returns the
     * same shape a catalogue download has.
     *
     * **The service fetches it, not the plugin.** That is what keeps one rule
     * true everywhere: a Minecraft server only ever downloads from a server it
     * is configured to trust, and always against a checksum that server
     * declared. Handing the plugin a third-party URL would break both halves.
     */
    async resolve({ sourceType, sourceRef, kind, serverId, maxBytes }) {
      const location = resolveReference(sourceType, sourceRef);

      let url: URL;
      try {
        url = await assertFetchable(location.url);
      } catch (error) {
        if (error instanceof UnsafeUrlError) {
          throw errors.badRequest('unsafe_source_url', error.message);
        }
        throw error;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await fetcher(url.toString(), { signal: controller.signal });
      } catch (error) {
        throw errors.badRequest('source_unreachable', 'That source could not be fetched.', {
          reason: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw errors.badRequest('source_unreachable', `That source answered ${response.status}.`, {
          status: response.status,
        });
      }

      // The declared length is checked before the body is read, and the actual
      // length after -- a source that lies about one is exactly the case the
      // second check exists for.
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw errors.payloadTooLarge('source_too_large', 'That artifact is larger than the limit.', {
          limit: maxBytes,
        });
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) {
        throw errors.payloadTooLarge('source_too_large', 'That artifact is larger than the limit.', {
          limit: maxBytes,
        });
      }

      // A mirrored artifact goes through exactly the same checks as an upload.
      // A jar from elsewhere is not more trustworthy for having come from a
      // well-known host.
      inspectJar(bytes, kind);

      const stored = await storage.put(bytes);
      const id = ulid();

      await db
        .insertInto('external_sources')
        .values({
          id,
          product_id: null,
          server_id: serverId ?? null,
          source_type: sourceType,
          source_ref: sourceRef,
          created_at: now(),
        })
        .execute();

      const artifact: MirroredArtifact = {
        id,
        source_type: sourceType,
        source_ref: sourceRef,
        file_name: safeFileName(location.fileName),
        size_bytes: stored.sizeBytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        download_url: `/api/v1/sources/${id}/download`,
      };

      mirrors.set(id, { key: stored.key, artifact });
      return artifact;
    },

    async find(id) {
      return mirrors.get(id)?.artifact;
    },

    async open(id) {
      const mirror = mirrors.get(id);
      if (mirror === undefined) {
        throw errors.notFound('source_not_found', 'No such mirrored artifact.');
      }
      return { artifact: mirror.artifact, key: mirror.key };
    },
  };
}
