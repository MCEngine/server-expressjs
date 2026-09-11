import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * An invariant about the repository rather than about the code in it.
 *
 * `src/storage/index.ts` was once ignored by a `.gitignore` pattern written for
 * a different directory — `storage/`, with no leading slash, matches at every
 * depth — so it was never committed. Every check stayed green, because every
 * check ran on a machine where the file already existed. The first environment
 * without it was a clean clone inside a Docker build, weeks later.
 *
 * A green test suite says nothing about whether the files it ran on are in git.
 * This one does.
 */
describe('the repository', () => {
  // No explicit cwd: vitest runs from the package root, and deriving a path
  // from `import.meta.url` would need platform-specific handling to get back a
  // real filesystem path.
  const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' });

  it('tracks every file under src/, so a clean clone is what was tested', () => {
    try {
      git('rev-parse', '--is-inside-work-tree');
    } catch {
      // Running from a tarball or without git. The invariant is about the
      // repository, and there is no repository here to assert it against.
      return;
    }

    const ignored = git('ls-files', '--others', '--ignored', '--exclude-standard', '--', 'src')
      .split('\n')
      .filter((line) => line !== '');

    expect(
      ignored,
      `These files are under src/ but git ignores them, so they are not in the repository and a
clean clone will not build. Anchor the pattern that matches them with a leading slash — an
ignore rule naming one directory at the repository root should say so:\n  ${ignored.join('\n  ')}`,
    ).toEqual([]);
  });
});
