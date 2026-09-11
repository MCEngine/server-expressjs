import busboy from 'busboy';
import type { Request } from 'express';
import { errors } from '../errors.js';

export interface UploadedFile {
  readonly fieldName: string;
  readonly fileName: string;
  readonly bytes: Buffer;
}

export interface MultipartBody {
  readonly fields: Readonly<Record<string, string>>;
  readonly file: UploadedFile;
}

/**
 * Reads a multipart request carrying exactly one file, refusing to buffer more
 * than `maxFileBytes`.
 *
 * The cap is enforced **while streaming**, not after: buffering a hostile upload
 * to memory and then measuring it is the denial of service the limit exists to
 * prevent. Busboy's own `limits.fileSize` truncates silently, so the stream is
 * measured here too and the request is failed rather than quietly shortened.
 */
export function readMultipart(req: Request, maxFileBytes: number): Promise<MultipartBody> {
  return new Promise((resolve, reject) => {
    const contentType = req.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data')) {
      reject(
        errors.badRequest('not_multipart', 'This route expects a multipart/form-data request.'),
      );
      return;
    }

    const parser = busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fields: 20,
        fieldSize: 1024 * 128,
        fileSize: maxFileBytes + 1,
      },
    });

    const fields: Record<string, string> = {};
    let file: UploadedFile | undefined;
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      req.unpipe(parser);
      parser.removeAllListeners();
      // Drain rather than leave the socket half-read, which some clients hold
      // open waiting for the body to be consumed.
      req.resume();
      reject(error);
    };

    parser.on('field', (name, value) => {
      fields[name] = value;
    });

    parser.on('file', (fieldName, stream, info) => {
      if (file !== undefined) {
        fail(errors.badRequest('too_many_files', 'Send exactly one file.'));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;

      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxFileBytes) {
          stream.destroy();
          fail(
            errors.payloadTooLarge('file_too_large', 'That file is larger than the limit.', {
              limit: maxFileBytes,
            }),
          );
          return;
        }
        chunks.push(chunk);
      });

      stream.on('limit', () => {
        fail(
          errors.payloadTooLarge('file_too_large', 'That file is larger than the limit.', {
            limit: maxFileBytes,
          }),
        );
      });

      stream.on('end', () => {
        if (settled) return;
        file = { fieldName, fileName: info.filename ?? 'artifact.jar', bytes: Buffer.concat(chunks) };
      });
    });

    parser.on('filesLimit', () => fail(errors.badRequest('too_many_files', 'Send exactly one file.')));
    parser.on('error', (error: unknown) =>
      fail(errors.badRequest('malformed_multipart', 'That multipart body could not be read.', {
        reason: error instanceof Error ? error.message : String(error),
      })),
    );

    parser.on('close', () => {
      if (settled) return;
      if (file === undefined) {
        fail(errors.badRequest('no_file', 'No file part was present in the request.'));
        return;
      }
      settled = true;
      resolve({ fields, file });
    });

    req.pipe(parser);
  });
}

/** Parses a JSON field from a multipart body, or returns undefined when absent. */
export function jsonField(fields: Readonly<Record<string, string>>, name: string): unknown {
  const raw = fields[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw errors.badRequest('malformed_field', `The ${name} field is not valid JSON.`);
  }
}
