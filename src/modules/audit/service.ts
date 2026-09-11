import type { Kysely } from 'kysely';
import type { Database, FleetAction } from '../../db/schema.js';
import { ulid } from '../../lib/ids.js';
import { iso, type Clock } from '../../lib/clock.js';
import type { Actor } from '../auth/service.js';

export type SubjectType =
  | 'account'
  | 'org'
  | 'product'
  | 'product_version'
  | 'server'
  | 'token'
  | 'news';

export interface AuditEntry {
  readonly actor?: Actor | undefined;
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  readonly action: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly ip?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
}

export interface FleetEntry {
  readonly serverId: string;
  readonly action: FleetAction;
  readonly productId?: string | null | undefined;
  readonly versionId?: string | null | undefined;
  readonly detail?: Record<string, unknown> | undefined;
  readonly bytesSent?: number | null | undefined;
}

export interface AuditReadOptions {
  readonly subjectType?: SubjectType | undefined;
  readonly subjectId?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface AuditService {
  record(entry: AuditEntry): Promise<void>;
  recordFleet(entry: FleetEntry): Promise<void>;
  read(options: AuditReadOptions): Promise<AuditRow[]>;
  readFleet(serverId: string, limit: number, cursor?: string): Promise<FleetRow[]>;
}

export interface AuditRow {
  id: string;
  actor_account_id: string | null;
  actor_token_id: string | null;
  subject_type: string;
  subject_id: string;
  action: string;
  metadata: string | null;
  ip: string | null;
  created_at: string;
}

export interface FleetRow {
  id: string;
  server_id: string;
  product_id: string | null;
  version_id: string | null;
  action: FleetAction;
  detail: string | null;
  bytes_sent: number | null;
  created_at: string;
}

/**
 * Records what happened.
 *
 * **A failure to log never fails the request.** An audit write is a side effect
 * of an action that has already succeeded; turning a logging problem into a
 * user-visible error would make the service less reliable than not logging at
 * all. Failures are surfaced through the returned promise's rejection being
 * swallowed here and reported by the caller's own logger instead.
 */
export function createAuditService(
  db: Kysely<Database>,
  clock: Clock,
  onError: (error: unknown) => void = () => {},
): AuditService {
  const now = () => iso(clock.now());

  return {
    async record(entry) {
      try {
        await db
          .insertInto('audit_events')
          .values({
            id: ulid(),
            actor_account_id: entry.actor?.accountId ?? null,
            // Which credential acted is often the point of the entry, so the
            // two actor columns are separate and at most one is set.
            actor_token_id: entry.actor?.kind === 'token' ? entry.actor.tokenId : null,
            subject_type: entry.subjectType,
            subject_id: entry.subjectId,
            action: entry.action,
            metadata: entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
            ip: entry.ip ?? null,
            user_agent: entry.userAgent ?? null,
            created_at: now(),
          })
          .execute();
      } catch (error) {
        onError(error);
      }
    },

    async recordFleet(entry) {
      try {
        await db
          .insertInto('fleet_events')
          .values({
            id: ulid(),
            server_id: entry.serverId,
            product_id: entry.productId ?? null,
            version_id: entry.versionId ?? null,
            action: entry.action,
            detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
            bytes_sent: entry.bytesSent ?? null,
            created_at: now(),
          })
          .execute();
      } catch (error) {
        onError(error);
      }
    },

    async read({ subjectType, subjectId, limit, cursor }) {
      let query = db
        .selectFrom('audit_events')
        .select([
          'id', 'actor_account_id', 'actor_token_id', 'subject_type', 'subject_id',
          'action', 'metadata', 'ip', 'created_at',
        ]);
      if (subjectType !== undefined) query = query.where('subject_type', '=', subjectType);
      if (subjectId !== undefined) query = query.where('subject_id', '=', subjectId);
      if (cursor !== undefined) query = query.where('id', '<', cursor);
      return (await query.orderBy('id', 'desc').limit(limit).execute()) as AuditRow[];
    },

    async readFleet(serverId, limit, cursor) {
      let query = db
        .selectFrom('fleet_events')
        .select([
          'id', 'server_id', 'product_id', 'version_id', 'action', 'detail', 'bytes_sent',
          'created_at',
        ])
        .where('server_id', '=', serverId);
      if (cursor !== undefined) query = query.where('id', '<', cursor);
      return (await query.orderBy('id', 'desc').limit(limit).execute()) as FleetRow[];
    },
  };
}

/** An audit service that records nothing. For tests that are not about logging. */
export function nullAuditService(): AuditService {
  return {
    record: async () => {},
    recordFleet: async () => {},
    read: async () => [],
    readFleet: async () => [],
  };
}
