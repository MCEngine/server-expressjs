import type { Kysely } from 'kysely';
import type {
  Database,
  ProductKind,
  ProductVisibility,
  ReleaseChannel,
  UploadSource,
} from '../../db/schema.js';

export interface ProductRecord {
  id: string;
  slug: string;
  owner_org_id: string;
  name: string;
  summary: string;
  description: string | null;
  kind: ProductKind;
  repo_url: string | null;
  homepage_url: string | null;
  license: string | null;
  visibility: ProductVisibility;
  slug_changed_at: string | null;
  downloads_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface VersionRecord {
  id: string;
  product_id: string;
  version: string;
  version_norm: string;
  channel: ReleaseChannel;
  changelog: string | null;
  is_latest: boolean;
  published_at: string | null;
  created_at: string;
}

export interface FileRecord {
  version_id: string;
  file_name: string;
  storage_key: string;
  size_bytes: number;
  sha256: string;
  content_type: string;
  upload_source: UploadSource;
  created_at: string;
}

export interface PublishInput {
  versionId: string;
  productId: string;
  ownerOrgId: string;
  version: string;
  versionNorm: string;
  channel: ReleaseChannel;
  changelog: string | null;
  fileName: string;
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  uploadedBy: string | null;
  uploadSource: UploadSource;
  compatibility: readonly { platform: string; minecraftVersion: string }[];
  at: string;
}

/**
 * Filters for a catalogue search.
 *
 * The optional properties spell `undefined` out because a caller builds this
 * from parsed query parameters, where an absent filter is a key present and
 * undefined rather than a key missing.
 */
export interface SearchInput {
  kind?: ProductKind | undefined;
  limit: number;
  cursor?: string | undefined;
}

/** Why a publish transaction refused. */
export type PublishOutcome = 'ok' | 'quota_exceeded' | 'version_exists';

export interface ProductRepository {
  findBySlug(slug: string): Promise<ProductRecord | undefined>;
  findById(id: string): Promise<ProductRecord | undefined>;
  slugExists(slug: string): Promise<boolean>;
  insert(input: Omit<ProductRecord, 'downloads_count'>): Promise<void>;
  update(id: string, patch: Record<string, unknown>, at: string): Promise<void>;
  replaceSlug(id: string, from: string, to: string, at: string, historyId: string): Promise<void>;
  softDelete(id: string, at: string): Promise<void>;
  listByOrg(orgId: string, includeDeleted: boolean): Promise<ProductRecord[]>;
  search(input: SearchInput): Promise<ProductRecord[]>;

  listVersions(productId: string): Promise<VersionRecord[]>;
  findVersion(productId: string, version: string): Promise<VersionRecord | undefined>;
  findLatest(productId: string, channel: ReleaseChannel): Promise<VersionRecord | undefined>;
  findFile(versionId: string): Promise<FileRecord | undefined>;
  listCompatibility(versionId: string): Promise<{ platform: string; minecraft_version: string }[]>;

  publish(input: PublishInput): Promise<PublishOutcome>;
  deleteVersion(versionId: string, ownerOrgId: string, sizeBytes: number, at: string): Promise<void>;
  incrementDownloads(productId: string): Promise<void>;
}

const PRODUCT_COLUMNS = [
  'id', 'slug', 'owner_org_id', 'name', 'summary', 'description', 'kind', 'repo_url',
  'homepage_url', 'license', 'visibility', 'slug_changed_at', 'downloads_count',
  'created_at', 'updated_at', 'deleted_at',
] as const;

const VERSION_COLUMNS = [
  'id', 'product_id', 'version', 'version_norm', 'channel', 'changelog', 'is_latest',
  'published_at', 'created_at',
] as const;

export function createProductRepository(db: Kysely<Database>): ProductRepository {
  const live = () => db.selectFrom('products').select(PRODUCT_COLUMNS).where('deleted_at', 'is', null);

  return {
    async findBySlug(slug) {
      return (await live().where('slug', '=', slug).executeTakeFirst()) as ProductRecord | undefined;
    },

    async findById(id) {
      return (await live().where('id', '=', id).executeTakeFirst()) as ProductRecord | undefined;
    },

    async slugExists(slug) {
      // Includes soft-deleted rows: the slug is still held by the unique index,
      // so reporting it as free would produce a constraint error instead.
      const row = await db.selectFrom('products').select('id').where('slug', '=', slug).executeTakeFirst();
      return row !== undefined;
    },

    async insert(input) {
      await db.insertInto('products').values({ ...input }).execute();
    },

    async update(id, patch, at) {
      await db
        .updateTable('products')
        .set({ ...patch, updated_at: at } as never)
        .where('id', '=', id)
        .execute();
    },

    async replaceSlug(id, from, to, at, historyId) {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('product_slug_history')
          .values({ id: historyId, product_id: id, slug: from, released_at: at })
          .execute();
        await trx
          .updateTable('products')
          .set({ slug: to, slug_changed_at: at, updated_at: at })
          .where('id', '=', id)
          .execute();
      });
    },

    async softDelete(id, at) {
      await db
        .updateTable('products')
        .set({ deleted_at: at, updated_at: at })
        .where('id', '=', id)
        .execute();
    },

    async listByOrg(orgId, includeDeleted) {
      let query = db.selectFrom('products').select(PRODUCT_COLUMNS).where('owner_org_id', '=', orgId);
      if (!includeDeleted) query = query.where('deleted_at', 'is', null);
      return (await query.orderBy('created_at', 'desc').execute()) as ProductRecord[];
    },

    async search({ kind, limit, cursor }) {
      let query = live().where('visibility', '=', 'public');
      if (kind !== undefined) query = query.where('kind', '=', kind);
      // The cursor encodes the sort key, not an offset: an offset re-reads rows
      // that shifted under it.
      if (cursor !== undefined) query = query.where('id', '<', cursor);
      return (await query.orderBy('id', 'desc').limit(limit).execute()) as ProductRecord[];
    },

    async listVersions(productId) {
      return (await db
        .selectFrom('product_versions')
        .select(VERSION_COLUMNS)
        .where('product_id', '=', productId)
        .orderBy('version_norm', 'desc')
        .execute()) as VersionRecord[];
    },

    async findVersion(productId, version) {
      return (await db
        .selectFrom('product_versions')
        .select(VERSION_COLUMNS)
        .where('product_id', '=', productId)
        .where('version', '=', version)
        .executeTakeFirst()) as VersionRecord | undefined;
    },

    async findLatest(productId, channel) {
      return (await db
        .selectFrom('product_versions')
        .select(VERSION_COLUMNS)
        .where('product_id', '=', productId)
        .where('channel', '=', channel)
        .where('is_latest', '=', true)
        .executeTakeFirst()) as VersionRecord | undefined;
    },

    async findFile(versionId) {
      return (await db
        .selectFrom('product_files')
        .select([
          'version_id', 'file_name', 'storage_key', 'size_bytes', 'sha256', 'content_type',
          'upload_source', 'created_at',
        ])
        .where('version_id', '=', versionId)
        .executeTakeFirst()) as FileRecord | undefined;
    },

    async listCompatibility(versionId) {
      return db
        .selectFrom('product_compatibility')
        .select(['platform', 'minecraft_version'])
        .where('version_id', '=', versionId)
        .execute();
    },

    async publish(input) {
      return db.transaction().execute(async (trx): Promise<PublishOutcome> => {
        const existing = await trx
          .selectFrom('product_versions')
          .select('id')
          .where('product_id', '=', input.productId)
          .where('version', '=', input.version)
          .executeTakeFirst();
        if (existing !== undefined) return 'version_exists';

        // The quota check IS the update. A conditional UPDATE is atomic on every
        // engine and needs no row lock, where a read-then-write lets two uploads
        // racing on a nearly-full quota both pass the read.
        const claimed = await trx
          .updateTable('org_settings')
          .set((eb) => ({
            storage_used_bytes: eb('storage_used_bytes', '+', input.sizeBytes),
            updated_at: input.at,
          }))
          .where('org_id', '=', input.ownerOrgId)
          .where((eb) =>
            eb(
              eb('storage_used_bytes', '+', input.sizeBytes),
              '<=',
              eb.ref('storage_quota_bytes'),
            ),
          )
          .executeTakeFirst();

        if ((claimed.numUpdatedRows ?? 0n) === 0n) return 'quota_exceeded';

        // A newly published version becomes the latest in its channel, so the
        // previous one must stop being it -- the partial unique index permits
        // exactly one.
        await trx
          .updateTable('product_versions')
          .set({ is_latest: false })
          .where('product_id', '=', input.productId)
          .where('channel', '=', input.channel)
          .where('is_latest', '=', true)
          .execute();

        await trx
          .insertInto('product_versions')
          .values({
            id: input.versionId,
            product_id: input.productId,
            version: input.version,
            version_norm: input.versionNorm,
            channel: input.channel,
            changelog: input.changelog,
            is_latest: true,
            published_at: input.at,
            created_at: input.at,
          })
          .execute();

        await trx
          .insertInto('product_files')
          .values({
            version_id: input.versionId,
            file_name: input.fileName,
            storage_key: input.storageKey,
            size_bytes: input.sizeBytes,
            sha256: input.sha256,
            content_type: input.contentType,
            uploaded_by: input.uploadedBy,
            upload_source: input.uploadSource,
            created_at: input.at,
          })
          .execute();

        if (input.compatibility.length > 0) {
          await trx
            .insertInto('product_compatibility')
            .values(
              input.compatibility.map((c) => ({
                version_id: input.versionId,
                platform: c.platform,
                minecraft_version: c.minecraftVersion,
              })),
            )
            .execute();
        }

        return 'ok';
      });
    },

    async deleteVersion(versionId, ownerOrgId, sizeBytes, at) {
      await db.transaction().execute(async (trx) => {
        // The file and the compatibility rows cascade from the version.
        await trx.deleteFrom('product_versions').where('id', '=', versionId).execute();
        await trx
          .updateTable('org_settings')
          .set((eb) => ({
            storage_used_bytes: eb('storage_used_bytes', '-', sizeBytes),
            updated_at: at,
          }))
          .where('org_id', '=', ownerOrgId)
          .execute();
      });
    },

    async incrementDownloads(productId) {
      await db
        .updateTable('products')
        .set((eb) => ({ downloads_count: eb('downloads_count', '+', 1) }))
        .where('id', '=', productId)
        .execute();
    },
  };
}
