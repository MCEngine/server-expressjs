import { accessSync, constants, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Config } from '../config.js';

/**
 * The directory the SQLite file will be created in, or `undefined` when the
 * configured provider does not write a local database.
 *
 * The `file:` prefix is stripped exactly as `createDialect` strips it, so this
 * cannot disagree with the path actually opened.
 */
export function sqliteDirectory(config: Config): string | undefined {
  if (config.DATABASE_PROVIDER !== 'sqlite') return undefined;
  return dirname(resolve(config.DATABASE_URL.replace(/^file:/, '')));
}

/**
 * Fails startup if a directory the service must write to is not writable.
 *
 * Without this, the first symptom is whatever the driver says — `SQLITE_CANTOPEN`
 * names neither the path nor the reason, and the reason is almost always
 * ownership: the service runs unprivileged, so a directory created by root, or a
 * volume mounted as root, is unusable no matter how correct the configuration is.
 *
 * A missing directory is created rather than refused. That is the ordinary case
 * on a fresh volume, and failing on it would be pedantry.
 */
export function ensureWritableDirectory(directory: string, what: string): void {
  try {
    mkdirSync(directory, { recursive: true });
    accessSync(directory, constants.W_OK);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `${what} is not writable: ${directory}. This service runs as an unprivileged user, so ` +
        `every directory it writes to must be owned by that user — a volume mounted here as ` +
        `root will fail this check even though the configuration is correct. (${reason})`,
    );
  }
}

/** Every directory this configuration requires the service to be able to write. */
export function writableDirectories(config: Config): ReadonlyArray<[string, string]> {
  const directories: Array<[string, string]> = [[config.STORAGE_DIR, 'STORAGE_DIR']];
  const sqlite = sqliteDirectory(config);
  if (sqlite !== undefined) directories.push([sqlite, 'The directory DATABASE_URL points into']);
  return directories;
}
