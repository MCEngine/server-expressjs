import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * An invariant between two lines of the Dockerfile that must agree.
 *
 * The image declares one writable path — its `VOLUME` — because `/app` is
 * created by `WORKDIR` as root and the runtime is unprivileged. Every
 * filesystem path the runtime stage defaults to therefore has to live under it.
 *
 * That was broken once: `STORAGE_DIR` was set to `/data/storage` and
 * `DATABASE_URL` was left at the source default `file:./dev.sqlite`, relative to
 * `/app`. The image built, pushed, and crash-looped with `SQLITE_CANTOPEN`,
 * which names neither the path nor the reason.
 *
 * This needs no Docker daemon, which is what lets it run in the gate that runs
 * on every change.
 */
describe('the container image', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

  /** `ENV` values in the runtime stage, with line continuations folded in. */
  const runtimeEnv = (): Map<string, string> => {
    const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
    const folded = runtime.replace(/\\\r?\n\s*/g, ' ');
    const env = new Map<string, string>();

    for (const line of folded.split('\n')) {
      const match = /^ENV\s+(.*)$/.exec(line.trim());
      if (match === null) continue;
      for (const [, key, value] of match[1]!.matchAll(/([A-Z_][A-Z0-9_]*)=(\S+)/g)) {
        env.set(key!, value!);
      }
    }
    return env;
  };

  const volumes = (): string[] =>
    [...dockerfile.matchAll(/^VOLUME\s+\[(.*)\]/gm)].flatMap(([, inner]) =>
      [...inner!.matchAll(/"([^"]+)"/g)].map(([, path]) => path!),
    );

  it('declares a volume', () => {
    expect(volumes()).not.toHaveLength(0);
  });

  it('defaults every writable path into the declared volume', () => {
    const declared = volumes();
    const env = runtimeEnv();

    // The two the service writes to. Adding a third writable path means adding
    // it here, which is the point: the list is the contract.
    const paths: Array<[string, string]> = [
      ['STORAGE_DIR', env.get('STORAGE_DIR') ?? ''],
      ['DATABASE_URL', (env.get('DATABASE_URL') ?? '').replace(/^file:/, '')],
    ];

    for (const [key, value] of paths) {
      expect(value, `${key} is not set in the runtime stage`).not.toBe('');
      expect(
        value.startsWith('/'),
        `${key} is relative (${value}). It would resolve against WORKDIR, which is root-owned, and this image runs unprivileged.`,
      ).toBe(true);
      expect(
        declared.some((volume) => value === volume || value.startsWith(`${volume}/`)),
        `${key} is ${value}, which is outside the declared volume(s) ${declared.join(', ')}. Only the volume is writable by the runtime user.`,
      ).toBe(true);
    }
  });
});
