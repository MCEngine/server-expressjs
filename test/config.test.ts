import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const minimal = { JWT_SECRET: 'a'.repeat(32) };

describe('loadConfig', () => {
  it('applies defaults for everything optional', () => {
    const config = loadConfig(minimal);
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_PROVIDER).toBe('sqlite');
  });

  it('coerces numeric values, which arrive from the environment as strings', () => {
    expect(loadConfig({ ...minimal, PORT: '8080' }).PORT).toBe(8080);
  });

  it('names the offending key when a value is invalid', () => {
    expect(() => loadConfig({ ...minimal, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('rejects a JWT secret short enough to be guessable', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects a database provider it has no dialect for', () => {
    expect(() => loadConfig({ ...minimal, DATABASE_PROVIDER: 'mongodb' })).toThrow(
      /DATABASE_PROVIDER/,
    );
  });

  it('is frozen, so nothing can reconfigure the process at runtime', () => {
    const config = loadConfig(minimal);
    expect(Object.isFrozen(config)).toBe(true);
  });
});
