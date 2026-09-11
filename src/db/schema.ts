import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * The typed shape of every table, matching `wiki/information/data-model.md`.
 *
 * Timestamps are declared as `string` on the way out and `string` on the way in:
 * the driver returns a `Date` on PostgreSQL and MySQL and a string on SQLite, so
 * `src/db/plugins.ts` normalizes reads to ISO-8601 UTC and every caller sees one
 * type. Doing it there rather than at each call site is what keeps a repository
 * free of dialect knowledge.
 */
type Timestamp = ColumnType<string, string, string>;

/** Stored as `1`/`0` on SQLite and MySQL; normalized on read. */
type Bool = ColumnType<boolean, boolean, boolean>;

export type AccountType = 'user' | 'org';
export type AccountStatus = 'active' | 'suspended' | 'deleted';
export type OrgRole = 'owner' | 'admin' | 'maintainer' | 'member';
export type MembershipTier = 'free' | 'pro' | 'enterprise';
export type IdentityProvider = 'github' | 'google' | 'discord';
export type ProductKind = 'bukkit_plugin' | 'mod_client' | 'mod_server';
export type ProductVisibility = 'public' | 'unlisted' | 'private';
export type ReleaseChannel = 'release' | 'beta' | 'alpha';
export type UploadSource = 'web' | 'ci';
export type ServerPlatform = 'spigot' | 'paper' | 'folia';
export type ServerPluginState = 'installed' | 'pending_update' | 'pending_delete' | 'failed';
export type SourceType = 'spigotmc' | 'modrinth' | 'hangar' | 'github_release' | 'direct_url';
export type FleetAction =
  | 'version_check'
  | 'download'
  | 'install'
  | 'update'
  | 'delete'
  | 'failed';

export interface AccountsTable {
  id: string;
  type: AccountType;
  status: AccountStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AccountProfilesTable {
  account_id: string;
  handle: string;
  display_name: string;
  handle_changed_at: Timestamp | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AccountHandleHistoryTable {
  id: string;
  account_id: string;
  handle: string;
  released_at: Timestamp;
}

export interface AccountEmailsTable {
  id: string;
  account_id: string;
  email: string;
  is_primary: Bool;
  verified_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OrgMembersTable {
  org_id: string;
  user_id: string;
  role: OrgRole;
  invited_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OrgSettingsTable {
  org_id: string;
  membership_tier: MembershipTier;
  storage_quota_bytes: number;
  storage_used_bytes: number;
  max_file_bytes: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CredentialsTable {
  account_id: string;
  password_hash: string;
  password_updated_at: Timestamp;
}

export interface IdentitiesTable {
  id: string;
  account_id: string;
  provider: IdentityProvider;
  provider_user_id: string;
  created_at: Timestamp;
}

export interface SessionsTable {
  id: string;
  account_id: string;
  refresh_token_hash: string;
  device_label: string | null;
  user_agent: string | null;
  ip_last_seen: string | null;
  created_at: Timestamp;
  last_used_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface VerificationTokensTable {
  id: string;
  account_id: string;
  purpose: 'email_verification' | 'password_reset';
  email: string;
  token_hash: string;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: Timestamp;
}

export interface ApiTokensTable {
  id: string;
  owner_account_id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes: string;
  expires_at: Timestamp | null;
  last_used_at: Timestamp | null;
  revoked_at: Timestamp | null;
  created_by: string;
  created_at: Timestamp;
}

export interface ProductsTable {
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
  slug_changed_at: Timestamp | null;
  downloads_count: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface ProductSlugHistoryTable {
  id: string;
  product_id: string;
  slug: string;
  released_at: Timestamp;
}

export interface ProductVersionsTable {
  id: string;
  product_id: string;
  version: string;
  version_norm: string;
  channel: ReleaseChannel;
  changelog: string | null;
  is_latest: Bool;
  published_at: Timestamp | null;
  created_at: Timestamp;
}

export interface ProductFilesTable {
  version_id: string;
  file_name: string;
  storage_key: string;
  size_bytes: number;
  sha256: string;
  content_type: string;
  uploaded_by: string | null;
  upload_source: UploadSource;
  created_at: Timestamp;
}

export interface ProductCompatibilityTable {
  version_id: string;
  platform: string;
  minecraft_version: string;
}

export interface MinecraftServersTable {
  id: string;
  owner_account_id: string;
  server_key: string;
  server_url: string | null;
  name: string;
  platform: ServerPlatform | null;
  mc_version: string | null;
  agent_version: string | null;
  last_seen_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ServerPluginsTable {
  server_id: string;
  plugin_id: string;
  product_id: string | null;
  installed_version: string | null;
  installed_sha256: string | null;
  desired_version: string | null;
  state: ServerPluginState;
  last_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ExternalSourcesTable {
  id: string;
  product_id: string | null;
  server_id: string | null;
  source_type: SourceType;
  source_ref: string;
  created_at: Timestamp;
}

export interface AuditEventsTable {
  id: string;
  actor_account_id: string | null;
  actor_token_id: string | null;
  subject_type: string;
  subject_id: string;
  action: string;
  metadata: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Timestamp;
}

export interface FleetEventsTable {
  id: string;
  server_id: string;
  product_id: string | null;
  version_id: string | null;
  action: FleetAction;
  detail: string | null;
  bytes_sent: number | null;
  created_at: Timestamp;
}

export interface NewsTable {
  id: string;
  author_account_id: string;
  title: string;
  summary: string;
  /** Markdown, as it was written. Never HTML. */
  body: string;
  /** When it was pulled from view, or null while it is visible. */
  hidden_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Database {
  accounts: AccountsTable;
  account_profiles: AccountProfilesTable;
  account_handle_history: AccountHandleHistoryTable;
  account_emails: AccountEmailsTable;
  org_members: OrgMembersTable;
  org_settings: OrgSettingsTable;
  credentials: CredentialsTable;
  identities: IdentitiesTable;
  sessions: SessionsTable;
  verification_tokens: VerificationTokensTable;
  api_tokens: ApiTokensTable;
  products: ProductsTable;
  product_slug_history: ProductSlugHistoryTable;
  product_versions: ProductVersionsTable;
  product_files: ProductFilesTable;
  product_compatibility: ProductCompatibilityTable;
  minecraft_servers: MinecraftServersTable;
  server_plugins: ServerPluginsTable;
  external_sources: ExternalSourcesTable;
  audit_events: AuditEventsTable;
  fleet_events: FleetEventsTable;
  news: NewsTable;
}

export type Account = Selectable<AccountsTable>;
export type NewAccount = Insertable<AccountsTable>;
export type AccountUpdate = Updateable<AccountsTable>;
export type Product = Selectable<ProductsTable>;
export type NewProduct = Insertable<ProductsTable>;
export type ProductVersion = Selectable<ProductVersionsTable>;
export type ProductFile = Selectable<ProductFilesTable>;
export type ApiToken = Selectable<ApiTokensTable>;
export type ServerPlugin = Selectable<ServerPluginsTable>;
export type MinecraftServer = Selectable<MinecraftServersTable>;
