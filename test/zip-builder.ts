import { crc32 } from 'node:zlib';

export interface ZipEntrySpec {
  name: string;
  content?: string;
  /** Overrides the declared uncompressed size in the central directory. */
  declaredUncompressedSize?: number;
  /** Sets the high 16 bits of the external attributes — 0xA1FF marks a symlink. */
  unixMode?: number;
}

/**
 * Builds a zip archive with STORED (uncompressed) entries.
 *
 * Written by hand so a test can produce an archive that is *deliberately* wrong
 * in one specific way — a path that escapes, a symlink, a declared size that
 * does not match the data — which no zip library will let you do.
 */
export function makeZip(entries: readonly ZipEntrySpec[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content ?? '', 'utf8');
    // `<<` in JavaScript is a signed 32-bit operation, so anything with the
    // high bit set comes back negative and writeUInt32LE refuses it.
    const crc = crc32(data) >>> 0;
    const declared = entry.declaredUncompressedSize ?? data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // method: stored
    localHeader.writeUInt16LE(0, 10); // time
    localHeader.writeUInt16LE(0, 12); // date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    local.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(declared, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    central.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }

  const localPart = Buffer.concat(local);
  const centralPart = Buffer.concat(central);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localPart, centralPart, eocd]);
}

/** A minimal, valid Bukkit plugin jar. */
export function bukkitJar(name = 'Example', version = '1.0.0'): Buffer {
  return makeZip([
    { name: 'plugin.yml', content: `name: ${name}\nversion: ${version}\nmain: com.example.Main\n` },
    { name: 'com/example/Main.class', content: 'not really bytecode' },
  ]);
}

/** A minimal, valid Fabric mod jar. */
export function fabricJar(): Buffer {
  return makeZip([{ name: 'fabric.mod.json', content: '{"id":"example","version":"1.0.0"}' }]);
}
