import { errors } from '../../errors.js';
import {
  hasZipMagic,
  isUnsafeEntryName,
  readCentralDirectory,
  ZipFormatError,
} from '../../lib/zip.js';
import type { ProductKind } from '../../db/schema.js';

/**
 * Limits on the shape of an archive, independent of its byte size.
 *
 * A 20 MB jar that declares 400 GB uncompressed, or one with a million entries,
 * is within any file-size limit and is still an attack on whatever extracts it.
 */
export const MAX_ENTRIES = 20_000;
export const MAX_UNCOMPRESSED_BYTES = 1_073_741_824; // 1 GiB
export const MAX_COMPRESSION_RATIO = 200;

/** Which descriptor a product of each kind must carry to be that kind. */
const REQUIRED_DESCRIPTORS: Record<ProductKind, readonly string[]> = {
  bukkit_plugin: ['plugin.yml', 'paper-plugin.yml'],
  mod_client: ['fabric.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml'],
  mod_server: ['fabric.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml'],
};

export interface JarInspection {
  readonly entryCount: number;
  readonly uncompressedBytes: number;
  readonly descriptor: string;
}

/**
 * Checks 4 through 8 of the upload path in `wiki/information/api-contract.md`,
 * in order, cheapest first.
 *
 * Nothing here decompresses anything: every fact comes from the central
 * directory, because decompressing to find out how big something decompresses to
 * is how a zip bomb wins.
 */
export function inspectJar(buffer: Buffer, kind: ProductKind): JarInspection {
  // 4. Magic bytes. Four bytes, before anything is parsed.
  if (!hasZipMagic(buffer)) {
    throw errors.unprocessable('not_a_jar', 'That file is not a jar: it is not a zip archive.');
  }

  // 5. It parses, and its central directory is internally consistent.
  let directory;
  try {
    directory = readCentralDirectory(buffer);
  } catch (error) {
    if (error instanceof ZipFormatError) {
      throw errors.unprocessable('not_a_jar', `That file is not a valid zip archive: ${error.message}`);
    }
    throw error;
  }

  // 6. No entry escapes the directory it would be extracted into.
  for (const entry of directory.entries) {
    if (isUnsafeEntryName(entry.name)) {
      throw errors.unprocessable(
        'unsafe_archive',
        'That archive contains an entry whose path would escape the directory it is extracted into.',
        { entry: entry.name.slice(0, 200) },
      );
    }
    if (entry.isSymlink) {
      throw errors.unprocessable(
        'unsafe_archive',
        'That archive contains a symbolic link.',
        { entry: entry.name.slice(0, 200) },
      );
    }
  }

  // 7. It is not a bomb.
  if (directory.entries.length > MAX_ENTRIES) {
    throw errors.unprocessable('archive_too_large', `That archive has more than ${MAX_ENTRIES} entries.`);
  }
  if (directory.totalUncompressedSize > MAX_UNCOMPRESSED_BYTES) {
    throw errors.unprocessable(
      'archive_too_large',
      'That archive declares more uncompressed data than is allowed.',
      { uncompressed_bytes: directory.totalUncompressedSize, limit: MAX_UNCOMPRESSED_BYTES },
    );
  }
  const ratio = directory.totalUncompressedSize / Math.max(buffer.length, 1);
  if (ratio > MAX_COMPRESSION_RATIO) {
    throw errors.unprocessable(
      'archive_too_large',
      'That archive expands by more than is plausible for a jar.',
      { ratio: Math.round(ratio) },
    );
  }

  // 8. It carries the descriptor the product's kind requires -- which is what
  // stops a mod being published as a plugin and failing at somebody's startup.
  const names = new Set(directory.entries.map((e) => e.name));
  const descriptor = REQUIRED_DESCRIPTORS[kind].find((candidate) => names.has(candidate));
  if (descriptor === undefined) {
    throw errors.unprocessable(
      'wrong_artifact_kind',
      `A ${kind.replace('_', ' ')} must contain one of: ${REQUIRED_DESCRIPTORS[kind].join(', ')}.`,
      { expected: REQUIRED_DESCRIPTORS[kind] },
    );
  }

  return {
    entryCount: directory.entries.length,
    uncompressedBytes: directory.totalUncompressedSize,
    descriptor,
  };
}

/**
 * Reduces an uploaded filename to something safe to store and echo.
 *
 * The result is data, never part of a path — `product_files.storage_key` is what
 * reaches a filesystem, and it is generated. This exists so the name shown in a
 * `Content-Disposition` header cannot carry a separator, a control character, or
 * a header terminator.
 */
export function safeFileName(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);

  return cleaned.length > 0 ? cleaned : 'artifact.jar';
}
