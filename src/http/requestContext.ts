import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates every log line and the error body for one request. */
      requestId: string;
    }
  }
}

/**
 * Assigns each request an id and echoes it as `X-Request-Id`.
 *
 * An inbound `X-Request-Id` is honoured so a trace started by a load balancer or
 * by the panel survives into this service's logs — but it is length-capped and
 * stripped of anything outside a conservative character set, because the value
 * ends up in a response header and in log lines, and neither should be a place a
 * caller can inject into.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const inbound = req.get('x-request-id');
  const clean =
    inbound !== undefined && /^[A-Za-z0-9._-]{1,128}$/.test(inbound) ? inbound : undefined;

  req.requestId = clean ?? randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
