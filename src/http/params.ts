import type { Request } from 'express';
import { errors } from '../errors.js';

/**
 * Reads one route parameter as a string.
 *
 * Express 5 types a param as `string | string[]`, because a pattern can repeat.
 * None of this service's routes do, so an array means the request did something
 * the route was not written for — which is a client error, not a place to guess
 * by taking the first element.
 */
export function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (typeof value === 'string') return value;
  throw errors.badRequest('invalid_path_parameter', `The ${name} path parameter is not valid.`);
}
