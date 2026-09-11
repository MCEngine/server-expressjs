/**
 * The single error shape every route returns, as specified in
 * `wiki/information/api-contract.md`.
 *
 * `code` is stable and is what a client branches on. `message` is for a person
 * and may be reworded without a version bump. `details` is optional and its
 * shape is documented per code.
 */
export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

/**
 * An error a route raises deliberately, carrying the status and machine-readable
 * code the contract promises.
 *
 * Anything thrown that is *not* an `ApiError` is a defect, and the handler
 * renders it as a bare `internal_error` without leaking its message — the
 * distinction is the point of having this class at all.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

/**
 * Constructors for the statuses the contract defines.
 *
 * They exist so a route names a status by what it means rather than by number,
 * and so the set of statuses this service can return stays enumerable.
 */
export const errors = {
  badRequest: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(400, code, message, details),

  unauthorized: (code = 'unauthorized', message = 'Authentication is required.') =>
    new ApiError(401, code, message),

  forbidden: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(403, code, message, details),

  notFound: (code = 'not_found', message = 'No such resource.') =>
    new ApiError(404, code, message),

  /** Handle taken, version already published, cooldown still running. */
  conflict: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(409, code, message, details),

  payloadTooLarge: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(413, code, message, details),

  /** The request was well-formed but the thing it carried is not usable. */
  unprocessable: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(422, code, message, details),

  tooManyRequests: (retryAfterSeconds: number) =>
    new ApiError(429, 'rate_limited', 'Too many requests.', {
      retry_after_seconds: retryAfterSeconds,
    }),

  /** The org's storage quota would be exceeded by this write. */
  insufficientStorage: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(507, code, message, details),
} as const;
