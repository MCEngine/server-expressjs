import type { Request } from 'express';
import { z } from 'zod';
import { errors } from '../../errors.js';
import { pathParam } from '../../http/params.js';

/**
 * Small pieces every central router shares.
 *
 * The plugins are Java clients built on Gson, which writes a `long` as a
 * string where precision matters and an `int` as a number, and keeps explicit
 * nulls -- so a field that is present and null means "clear it", and a field
 * that is absent means "leave it".
 */

/** A UUID as Java's `UUID.toString()` writes it, in either case. */
export const uuidSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Not a UUID.')
  .transform((value) => value.toLowerCase());

/** A whole number sent as a JSON number or as a string. */
export const integerSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/).transform(Number)]);

/** Reads a UUID path parameter, refusing anything else with a 400. */
export function uuidParam(req: Request, name: string): string {
  const parsed = uuidSchema.safeParse(pathParam(req, name));
  if (!parsed.success) throw errors.badRequest('invalid_uuid', `${name} is not a UUID.`);
  return parsed.data;
}

/** Reads a non-negative integer path parameter. */
export function intParam(req: Request, name: string): number {
  const raw = pathParam(req, name);
  if (!/^\d{1,9}$/.test(raw)) throw errors.badRequest('invalid_number', `${name} is not a number.`);
  return Number(raw);
}
