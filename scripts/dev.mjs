#!/usr/bin/env node
// Runs the server and web dev servers together for local development.
// Hand-rolled instead of adding a "concurrently"-style dependency (see
// PLAN.md §12 guardrail 6: stay within the dependency table).
import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['run', 'dev', '-w', 'server'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '-w', 'web'], { stdio: 'inherit' }),
];

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exitCode = code ?? 0;
}

for (const child of children) {
  child.on('exit', (code) => shutdown(code ?? 0));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
