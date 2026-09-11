import { describe, expect, it } from 'vitest';
import { inspectJar, safeFileName, MAX_ENTRIES } from '../src/modules/product/jar.js';
import { hasZipMagic, isUnsafeEntryName, readCentralDirectory } from '../src/lib/zip.js';
import { bukkitJar, fabricJar, makeZip } from './zip-builder.js';
import { ApiError } from '../src/errors.js';

function rejection(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected an ApiError, but nothing was thrown.');
}

describe('zip inspection', () => {
  it('reads the central directory of an archive it built', () => {
    const zip = makeZip([
      { name: 'a.txt', content: 'hello' },
      { name: 'b/c.txt', content: 'world!' },
    ]);
    const directory = readCentralDirectory(zip);

    expect(directory.entries.map((e) => e.name)).toEqual(['a.txt', 'b/c.txt']);
    expect(directory.totalUncompressedSize).toBe(11);
  });

  it('recognises the local file header signature', () => {
    expect(hasZipMagic(bukkitJar())).toBe(true);
    expect(hasZipMagic(Buffer.from('not a zip at all'))).toBe(false);
    expect(hasZipMagic(Buffer.alloc(2))).toBe(false);
  });

  it('rejects an archive with no end-of-central-directory record', () => {
    expect(() => readCentralDirectory(Buffer.from('PK\x03\x04 and then nothing'))).toThrow();
  });
});

describe('isUnsafeEntryName', () => {
  it.each([
    '../escape',
    'a/../../escape',
    '/absolute',
    'C:/windows/system32',
    '..\\windows',
    'nul\u0000/../etc',
    '',
  ])('rejects %j', (name) => {
    expect(isUnsafeEntryName(name)).toBe(true);
  });

  it.each(['plugin.yml', 'com/example/Main.class', 'META-INF/MANIFEST.MF', 'a..b/c'])(
    'accepts %j',
    (name) => {
      expect(isUnsafeEntryName(name)).toBe(false);
    },
  );
});

describe('inspectJar', () => {
  it('accepts a plugin jar for a bukkit_plugin product', () => {
    const result = inspectJar(bukkitJar(), 'bukkit_plugin');
    expect(result.descriptor).toBe('plugin.yml');
    expect(result.entryCount).toBe(2);
  });

  it('accepts paper-plugin.yml as well', () => {
    const zip = makeZip([{ name: 'paper-plugin.yml', content: 'name: Example' }]);
    expect(inspectJar(zip, 'bukkit_plugin').descriptor).toBe('paper-plugin.yml');
  });

  it('rejects a file that is not a zip, before parsing anything', () => {
    const error = rejection(() => inspectJar(Buffer.from('#!/bin/sh\nrm -rf /'), 'bukkit_plugin'));
    expect(error.code).toBe('not_a_jar');
    expect(error.status).toBe(422);
  });

  it('rejects a zip whose central directory is corrupt', () => {
    const zip = bukkitJar();
    // Find the first central directory header and wreck its signature, rather
    // than computing the offset by hand and quietly corrupting nothing.
    const at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(at).toBeGreaterThan(0);
    zip.writeUInt32LE(0xdeadbeef, at);

    const error = rejection(() => inspectJar(zip, 'bukkit_plugin'));
    expect(error.code).toBe('not_a_jar');
  });

  it('rejects an entry whose path escapes the extraction directory', () => {
    const zip = makeZip([
      { name: 'plugin.yml', content: 'name: Evil' },
      { name: '../../../../etc/cron.d/payload', content: '* * * * * root sh' },
    ]);
    const error = rejection(() => inspectJar(zip, 'bukkit_plugin'));
    expect(error.code).toBe('unsafe_archive');
    expect(error.details).toMatchObject({ entry: '../../../../etc/cron.d/payload' });
  });

  it('rejects a backslash path, which is a separator on Windows', () => {
    const zip = makeZip([
      { name: 'plugin.yml', content: 'name: Evil' },
      { name: '..\\..\\windows\\system32\\evil.dll', content: 'x' },
    ]);
    expect(rejection(() => inspectJar(zip, 'bukkit_plugin')).code).toBe('unsafe_archive');
  });

  it('rejects a symlink entry', () => {
    const zip = makeZip([
      { name: 'plugin.yml', content: 'name: Evil' },
      // 0xA1FF: S_IFLNK with permissions. Extracting this writes a link to
      // whatever the content names.
      { name: 'link', content: '/etc/shadow', unixMode: 0xa1ff },
    ]);
    expect(rejection(() => inspectJar(zip, 'bukkit_plugin')).code).toBe('unsafe_archive');
  });

  it('rejects an archive that declares an implausible expansion', () => {
    const zip = makeZip([
      { name: 'plugin.yml', content: 'name: Bomb' },
      // A few bytes of data declaring four gigabytes. Nothing is decompressed to
      // find this out, which is the point.
      { name: 'bomb', content: 'x', declaredUncompressedSize: 4_000_000_000 },
    ]);
    const error = rejection(() => inspectJar(zip, 'bukkit_plugin'));
    expect(error.code).toBe('archive_too_large');
  });

  it('rejects an archive with more entries than a jar plausibly has', () => {
    const entries = [{ name: 'plugin.yml', content: 'name: Many' }];
    for (let i = 0; i < MAX_ENTRIES + 1; i++) entries.push({ name: `f${i}`, content: '' });
    expect(rejection(() => inspectJar(makeZip(entries), 'bukkit_plugin')).code).toBe(
      'archive_too_large',
    );
  });

  it('rejects a mod jar published as a plugin', () => {
    const error = rejection(() => inspectJar(fabricJar(), 'bukkit_plugin'));
    expect(error.code).toBe('wrong_artifact_kind');
    expect(error.status).toBe(422);
  });

  it('rejects a plugin jar published as a mod', () => {
    expect(rejection(() => inspectJar(bukkitJar(), 'mod_client')).code).toBe('wrong_artifact_kind');
  });

  it('accepts any of the three mod descriptors', () => {
    for (const descriptor of ['fabric.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
      const zip = makeZip([{ name: descriptor, content: '{}' }]);
      expect(inspectJar(zip, 'mod_server').descriptor).toBe(descriptor);
    }
  });
});

describe('safeFileName', () => {
  it('keeps an ordinary name', () => {
    expect(safeFileName('MyPlugin-1.0.0.jar')).toBe('MyPlugin-1.0.0.jar');
  });

  it('reduces a path to its basename', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Windows\\evil.jar')).toBe('evil.jar');
  });

  it('strips what would break a Content-Disposition header', () => {
    expect(safeFileName('my"quoted".jar')).toBe('myquoted.jar');
    expect(safeFileName('a\r\nSet-Cookie: x=y.jar')).not.toContain('\n');
    expect(safeFileName('a\r\nSet-Cookie: x=y.jar')).not.toContain('\r');
  });

  it('treats a backslash as a separator, because Windows does', () => {
    expect(safeFileName('a"b\\c.jar')).toBe('c.jar');
  });

  it('never returns an empty name', () => {
    expect(safeFileName('')).toBe('artifact.jar');
    expect(safeFileName('...')).toBe('artifact.jar');
    expect(safeFileName('/')).toBe('artifact.jar');
  });
});
