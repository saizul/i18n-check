import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { run } from '../src/cli/run.js';

/** test/fixtures in the repository (tests run from dist/test). */
export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures');

export function fixture(name: string): string {
  return join(FIXTURES, name);
}

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'i18n-check-test-'));
  roots.push(root);
  return root;
}

/** A writable copy of a fixture project, for `fix` tests. */
export function copyFixture(name: string): string {
  const root = tempDir();
  cpSync(fixture(name), root, { recursive: true });
  return root;
}

/** A temporary project with the given files. */
export function project(files: Record<string, string>): string {
  const root = tempDir();
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

export async function cli(cwd: string, args: string[], env: Record<string, string | undefined> = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd,
    env,
    isTTY: false,
  });
  return { code, stdout, stderr };
}
