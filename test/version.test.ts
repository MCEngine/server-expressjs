import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isNewerThan,
  isVersionLike,
  normalizeVersion,
} from '../src/lib/version.js';

describe('normalizeVersion', () => {
  it('pads every segment so a text sort is a version sort', () => {
    expect(normalizeVersion('1.10.0')).toBe('00001.00010.00000.00000|');
    expect(normalizeVersion('1.9.0')).toBe('00001.00009.00000.00000|');
  });

  it('is the whole reason the column exists', () => {
    // The bug this prevents, stated as a test: compared as raw text, 1.9.0
    // sorts above 1.10.0 and an update runs backwards.
    expect('1.9.0' > '1.10.0').toBe(true);
    expect(normalizeVersion('1.9.0') > normalizeVersion('1.10.0')).toBe(false);
  });

  it('fills in missing segments', () => {
    expect(normalizeVersion('2')).toBe('00002.00000.00000.00000|');
    expect(normalizeVersion('2.1')).toBe('00002.00001.00000.00000|');
  });

  it('tolerates a leading v and surrounding space', () => {
    expect(normalizeVersion(' v3.2.1 ')).toBe(normalizeVersion('3.2.1'));
  });

  it('keeps a pre-release suffix separate from the release core', () => {
    expect(normalizeVersion('1.0.0-beta.1')).toBe('00001.00000.00000.00000|beta.1');
  });

  it('treats a non-numeric segment as zero rather than throwing', () => {
    expect(normalizeVersion('1.x.3')).toBe('00001.00000.00003.00000|');
  });
});

describe('compareVersions', () => {
  it('orders by numeric value, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('puts a pre-release before its release, as semver requires', () => {
    // The normalized strings sort the other way round, so this asserts the
    // correction rather than the encoding.
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
  });

  it('orders two pre-releases of the same core against each other', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
  });

  it('sorts a realistic list the way a person would', () => {
    const sorted = ['1.10.0', '1.2.0', '0.9.9', '1.9.0', '2.0.0-rc.1', '2.0.0'].sort(
      compareVersions,
    );
    expect(sorted).toEqual(['0.9.9', '1.2.0', '1.9.0', '1.10.0', '2.0.0-rc.1', '2.0.0']);
  });
});

describe('isNewerThan', () => {
  it('is what decides whether the plugin stages an update', () => {
    expect(isNewerThan('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerThan('1.9.0', '1.10.0')).toBe(false);
    expect(isNewerThan('1.9.0', '1.9.0')).toBe(false);
  });
});

describe('isVersionLike', () => {
  it.each(['1', '1.2', '1.2.3', 'v1.2.3', '1.2.3-beta.1'])('accepts %s', (v) => {
    expect(isVersionLike(v)).toBe(true);
  });

  it.each(['', 'latest', '1.2.3 (build)', '../../etc/passwd'])('rejects %s', (v) => {
    expect(isVersionLike(v)).toBe(false);
  });
});
