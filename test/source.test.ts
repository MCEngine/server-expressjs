import { describe, expect, it } from 'vitest';
import { assertFetchable, isPrivateAddress, UnsafeUrlError } from '../src/lib/net.js';
import { resolveReference } from '../src/modules/source/resolvers.js';
import { createSourceService, type Fetcher } from '../src/modules/source/index.js';
import { createMemoryStorage } from '../src/storage/index.js';
import { fixedClock } from '../src/lib/clock.js';
import { freshDatabase } from './db-helpers.js';
import { bukkitJar, fabricJar } from './zip-builder.js';
import { ApiError } from '../src/errors.js';

const publicDns = async () => [{ address: '93.184.216.34' }];

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // the cloud metadata address
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('refuses %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946'])(
    'allows %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it('refuses anything that is not an address at all', () => {
    expect(isPrivateAddress('not-an-address')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });
});

describe('assertFetchable', () => {
  it('accepts an https URL on a public host', async () => {
    await expect(assertFetchable('https://example.com/a.jar', publicDns)).resolves.toBeInstanceOf(URL);
  });

  it.each([
    'http://example.com/a.jar',
    'file:///etc/passwd',
    'gopher://example.com/',
  ])('refuses %s', async (url) => {
    await expect(assertFetchable(url, publicDns)).rejects.toThrow(UnsafeUrlError);
  });

  it('refuses a URL carrying credentials', async () => {
    await expect(assertFetchable('https://user:pw@example.com/a.jar', publicDns)).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('refuses a private address written as a literal', async () => {
    for (const host of ['127.0.0.1', '169.254.169.254', '[::1]', '10.1.2.3']) {
      await expect(assertFetchable(`https://${host}/a.jar`, publicDns)).rejects.toThrow(
        UnsafeUrlError,
      );
    }
  });

  it('refuses localhost and .internal by name', async () => {
    for (const host of ['localhost', 'db.internal', 'api.localhost']) {
      await expect(assertFetchable(`https://${host}/a.jar`, publicDns)).rejects.toThrow(
        UnsafeUrlError,
      );
    }
  });

  it('refuses a public name that resolves to a private address', async () => {
    // The whole point: a hostname is not a promise about where it points.
    const rebinding = async () => [{ address: '169.254.169.254' }];
    await expect(assertFetchable('https://evil.example.com/a.jar', rebinding)).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('refuses a name with one public and one private answer', async () => {
    const mixed = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.1' }];
    // Which one a later connection picks is not something this check controls.
    await expect(assertFetchable('https://mixed.example.com/a.jar', mixed)).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('refuses a name that resolves to nothing', async () => {
    await expect(assertFetchable('https://void.example.com/a.jar', async () => [])).rejects.toThrow(
      UnsafeUrlError,
    );
  });
});

describe('resolveReference', () => {
  it('builds a URL for each source type', () => {
    expect(resolveReference('spigotmc', '12345').url).toContain('/resources/12345/download');
    expect(resolveReference('modrinth', 'worldedit').url).toContain('/project/worldedit/');
    expect(resolveReference('hangar', 'EssentialsX/Essentials').url).toContain('EssentialsX/Essentials');
    expect(resolveReference('github_release', 'acme/tools@v1.2.3').url).toContain('acme/tools');
    expect(resolveReference('direct_url', 'https://example.com/a.jar').url).toBe(
      'https://example.com/a.jar',
    );
  });

  it('refuses a reference that would smuggle a path into the URL', () => {
    // Each of these is the shape of the attack the per-type validation exists
    // to stop: escaping the API path the resolver is building.
    expect(() => resolveReference('spigotmc', '../../admin')).toThrow(ApiError);
    expect(() => resolveReference('modrinth', '../../../etc/passwd')).toThrow(ApiError);
    expect(() => resolveReference('hangar', 'owner/../../x')).toThrow(ApiError);
    expect(() => resolveReference('github_release', 'a/b@../../c')).toThrow(ApiError);
  });

  it('names the downloaded file after the reference, not after the response', () => {
    expect(resolveReference('github_release', 'acme/tools@v1.2.3').fileName).toBe('tools-v1.2.3.jar');
    expect(resolveReference('direct_url', 'https://example.com/evil.sh').fileName).toBe(
      'artifact.jar',
    );
  });
});

describe('the source service', () => {
  const fetcherFor = (bytes: Buffer, ok = true, status = 200): Fetcher =>
    async () => ({
      ok,
      status,
      headers: { get: (name) => (name === 'content-length' ? String(bytes.length) : null) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer,
    });

  const build = async (fetcher: Fetcher) => {
    const db = await freshDatabase();
    const storage = createMemoryStorage();
    const service = createSourceService(db.db, storage, fixedClock('2026-01-01T00:00:00.000Z'), fetcher);
    return { db, storage, service };
  };

  it('mirrors an artifact and returns the same shape a catalogue download has', async () => {
    const jar = bukkitJar();
    const { db, storage, service } = await build(fetcherFor(jar));
    try {
      const artifact = await service.resolve({
        sourceType: 'direct_url',
        sourceRef: 'https://example.com/Tools-1.0.0.jar',
        kind: 'bukkit_plugin',
        maxBytes: 1_000_000,
      });

      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.size_bytes).toBe(jar.length);
      expect(artifact.download_url).toContain('/download');
      // The service holds the bytes, so the plugin never fetches from a third
      // party and never verifies against a checksum it did not get from here.
      expect(storage.objects.size).toBe(1);
    } finally {
      await db.destroy();
    }
  });

  it('puts a mirrored jar through the same checks as an upload', async () => {
    const { db, service } = await build(fetcherFor(fabricJar()));
    try {
      // A jar from a well-known host is not more trustworthy for that.
      await expect(
        service.resolve({
          sourceType: 'direct_url',
          sourceRef: 'https://example.com/mod.jar',
          kind: 'bukkit_plugin',
          maxBytes: 1_000_000,
        }),
      ).rejects.toThrow(ApiError);
    } finally {
      await db.destroy();
    }
  });

  it('refuses a source whose body exceeds the limit even if it lied about the length', async () => {
    const jar = bukkitJar();
    const lying: Fetcher = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => '10' },
      arrayBuffer: async () => jar.buffer.slice(jar.byteOffset, jar.byteOffset + jar.length) as ArrayBuffer,
    });
    const { db, service } = await build(lying);
    try {
      await expect(
        service.resolve({
          sourceType: 'direct_url',
          sourceRef: 'https://example.com/a.jar',
          kind: 'bukkit_plugin',
          maxBytes: 20,
        }),
      ).rejects.toMatchObject({ code: 'source_too_large' });
    } finally {
      await db.destroy();
    }
  });

  it('refuses an unreachable source without treating it as a defect', async () => {
    const { db, service } = await build(fetcherFor(Buffer.alloc(0), false, 404));
    try {
      await expect(
        service.resolve({
          sourceType: 'direct_url',
          sourceRef: 'https://example.com/gone.jar',
          kind: 'bukkit_plugin',
          maxBytes: 1_000_000,
        }),
      ).rejects.toMatchObject({ code: 'source_unreachable', status: 400 });
    } finally {
      await db.destroy();
    }
  });

  it('refuses to fetch a private address', async () => {
    const { db, service } = await build(fetcherFor(bukkitJar()));
    try {
      await expect(
        service.resolve({
          sourceType: 'direct_url',
          sourceRef: 'https://169.254.169.254/latest/meta-data/',
          kind: 'bukkit_plugin',
          maxBytes: 1_000_000,
        }),
      ).rejects.toMatchObject({ code: 'unsafe_source_url' });
    } finally {
      await db.destroy();
    }
  });
});
