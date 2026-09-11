import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureWritableDirectory, sqliteDirectory, writableDirectories } from '../src/lib/writable.js';
import { loadConfig } from '../src/config.js';

const base = {
  JWT_SECRET: 'x'.repeat(32),
  STORAGE_DIR: '/srv/artifacts',
};

describe('writable paths', () => {
  it('reads the sqlite directory the same way the dialect reads the file', () => {
    const config = loadConfig({ ...base, DATABASE_PROVIDER: 'sqlite', DATABASE_URL: 'file:/data/app.sqlite' });
    expect(sqliteDirectory(config)).toBe('/data');
  });

  it('has no sqlite directory when the database is somewhere else', () => {
    const config = loadConfig({
      ...base,
      DATABASE_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgres://u:p@db:5432/x',
    });
    expect(sqliteDirectory(config)).toBeUndefined();
    expect(writableDirectories(config).map(([, what]) => what)).toEqual(['STORAGE_DIR']);
  });

  it('creates a missing directory rather than refusing it', () => {
    const root = mkdtempSync(join(tmpdir(), 'writable-'));
    const nested = join(root, 'a', 'b', 'c');
    expect(() => ensureWritableDirectory(nested, 'STORAGE_DIR')).not.toThrow();
  });

  it('names the path and the likely cause when it cannot be used', () => {
    // A path whose parent is a file can never be a directory, which is the one
    // failure reproducible without dropping privileges.
    const root = mkdtempSync(join(tmpdir(), 'writable-'));
    const file = join(root, 'not-a-directory');
    writeFileSync(file, '');

    expect(() => ensureWritableDirectory(join(file, 'sub'), 'STORAGE_DIR')).toThrow(
      /STORAGE_DIR is not writable: .*not-a-directory\/sub\. This service runs as an unprivileged user/,
    );
  });
});
