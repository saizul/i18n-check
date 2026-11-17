import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Converts a glob to a regular expression. Supports `**`, `*`, `?`,
 * `{a,b}` and character classes `[abc]`. Paths use forward slashes.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let inGroup = false;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories; a trailing `**` matches everything.
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      inGroup = true;
      re += '(?:';
    } else if (c === '}' && inGroup) {
      inGroup = false;
      re += ')';
    } else if (c === ',' && inGroup) {
      re += '|';
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) {
        re += '\\[';
      } else {
        const body = glob
          .slice(i + 1, end)
          .replace(/^!/, '^')
          .replace(/\\/g, '\\\\');
        re += `[${body}]`;
        i = end;
      }
    } else {
      re += c.replace(/[.+^$()|\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'vendor',
  'out',
]);

/**
 * Lists files under `root` (relative, forward slashes) whose path matches
 * any of the globs. Common output and dependency folders are skipped.
 */
export function findFiles(
  root: string,
  globs: string[],
  options: { ignore?: string[]; skipDirs?: Set<string>; maxFiles?: number } = {},
): string[] {
  const include = globs.map(globToRegExp);
  const ignore = (options.ignore ?? []).map(globToRegExp);
  const skip = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const max = options.maxFiles ?? 20_000;
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (out.length >= max) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        if (ignore.some((r) => r.test(rel) || r.test(`${rel}/`))) continue;
        walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        if (include.some((r) => r.test(rel)) && !ignore.some((r) => r.test(rel))) out.push(rel);
      }
    }
  };
  walk(root, '');
  return out;
}

/** True when the string contains glob syntax. */
export function isGlob(s: string): boolean {
  return /[*?{[]/.test(s);
}
