#!/usr/bin/env node
import { run } from './cli/run.js';

run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  isTTY: process.stdout.isTTY === true,
  env: process.env,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`i18n-check: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
  },
);
