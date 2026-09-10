/**
 * A read-only inspector for the zip central directory.
 *
 * It never decompresses anything. Every check the upload path needs — entry
 * names, entry count, declared uncompressed size, whether a descriptor is
 * present — is answerable from the central directory alone, and decompressing to
 * find out is precisely how a zip bomb wins.
 *
 * Written here rather than taken as a dependency because the useful surface is
 * "read these five fields", the format is a frozen published specification, and
 * a general-purpose zip library's default behaviour is to extract — which is the
 * one thing this must not do.
 */

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT = 0xffff;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Unix mode bits, in the high 16 of the external attributes, marking a symlink. */
const S_IFLNK = 0xa000;
const S_IFMT = 0xf000;

export interface ZipEntry {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly isDirectory: boolean;
  readonly isSymlink: boolean;
}

export interface ZipDirectory {
  readonly entries: readonly ZipEntry[];
  readonly totalUncompressedSize: number;
}

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

/** True when the buffer starts with the local file header signature. */
export function hasZipMagic(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === LOCAL_SIGNATURE;
}

/**
 * Reads the central directory.
 *
 * Throws `ZipFormatError` for anything malformed, which the caller renders as
 * `422 not_a_jar` — a file that does not parse is a client error, never a defect.
 */
export function readCentralDirectory(buffer: Buffer): ZipDirectory {
  const eocd = findEndOfCentralDirectory(buffer);

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);

  if (directoryOffset + directorySize > buffer.length) {
    throw new ZipFormatError('The central directory extends past the end of the file.');
  }

  const entries: ZipEntry[] = [];
  let total = 0;
  let cursor = directoryOffset;

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > buffer.length) {
      throw new ZipFormatError('The central directory ends mid-entry.');
    }
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipFormatError(`Central directory entry ${i} has no signature.`);
    }

    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);

    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) {
      throw new ZipFormatError(`Entry ${i} declares a name past the end of the file.`);
    }

    // Names are stored as raw bytes. Decoded as UTF-8 without validation so a
    // deliberately invalid sequence cannot smuggle a separator past the checks.
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
    const unixMode = (externalAttributes >>> 16) & 0xffff;

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      isDirectory: name.endsWith('/'),
      isSymlink: (unixMode & S_IFMT) === S_IFLNK,
    });
    total += uncompressedSize;

    cursor = nameEnd + extraLength + commentLength;
  }

  return { entries, totalUncompressedSize: total };
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < EOCD_MIN_SIZE) {
    throw new ZipFormatError('The file is too short to be a zip archive.');
  }

  // The record is at the end, but a trailing comment of up to 64 KiB may follow
  // it, so it is searched for backwards rather than assumed to be last.
  const earliest = Math.max(0, buffer.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT);
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= earliest; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }

  throw new ZipFormatError('No end-of-central-directory record was found.');
}

/**
 * True when an entry name would escape the directory it is extracted into.
 *
 * This service never extracts an uploaded jar. The check is here anyway because
 * the panel might, and future tooling might — a guard that holds only while
 * nobody downstream extracts the archive is not a guard.
 */
export function isUnsafeEntryName(name: string): boolean {
  if (name.length === 0) return true;
  // Backslashes are separators on Windows and are not normalized by the format.
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return true;
  if (/^[A-Za-z]:/.test(normalized)) return true;
  if (normalized.split('/').includes('..')) return true;
  // A NUL truncates a path in some C APIs, so "a.txt\0/../../etc" reads as two
  // different paths depending on who looks at it.
  if (normalized.includes('\0')) return true;
  return false;
}
