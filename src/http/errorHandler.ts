import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError, errors, type ErrorBody } from '../errors.js';
import type { Logger } from '../lib/logger.js';

/** Terminal 404 for anything no route matched. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(errors.notFound('route_not_found', 'No such route.'));
};

/**
 * Renders every error as the one envelope the contract promises.
 *
 * An `ApiError` was raised on purpose and its message is safe to show. Anything
 * else is a defect: it is logged in full with the request id, and the caller
 * gets a bare `internal_error` — because an unexpected exception's message is
 * exactly the kind of thing that carries a query fragment or a file path.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) {
      // The response is already streaming, so the envelope cannot be written.
      // Destroy rather than leave the client waiting on a body that never ends.
      logger.error('error after response started', {
        requestId: req.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.destroy();
      return;
    }

    if (err instanceof ApiError) {
      if (err.status === 429) {
        const retry = err.details?.['retry_after_seconds'];
        if (typeof retry === 'number') res.setHeader('Retry-After', String(retry));
      }
      logger.warn('request rejected', {
        requestId: req.requestId,
        status: err.status,
        code: err.code,
        path: req.path,
      });
      res.status(err.status).json(err.toBody());
      return;
    }

    // Express's own body parser raises this for malformed JSON. It is a client
    // error, not a defect, so it is translated rather than swallowed as a 500.
    if (err instanceof SyntaxError && 'body' in err) {
      const body: ErrorBody = {
        error: { code: 'malformed_json', message: 'The request body is not valid JSON.' },
      };
      res.status(400).json(body);
      return;
    }

    logger.error('unhandled error', {
      requestId: req.requestId,
      path: req.path,
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    });

    const body: ErrorBody = {
      error: {
        code: 'internal_error',
        message: 'Something went wrong.',
        details: { request_id: req.requestId },
      },
    };
    res.status(500).json(body);
  };
}
