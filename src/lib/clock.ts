/**
 * The source of "now".
 *
 * Passed in rather than read from `Date.now()` at the call site so a cooldown
 * test can assert the boundary — twenty-nine days rejected, thirty-one accepted
 * — without sleeping or mocking a global.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  const at = new Date(iso);
  return { now: () => at };
}

export const iso = (date: Date): string => date.toISOString();

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function daysBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000);
}
