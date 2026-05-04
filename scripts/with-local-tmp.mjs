#!/usr/bin/env node
// PHO-258: Sandbox the build's temp dir to a project-local path.
//
// Why: On Windows, Next.js's bundled glob (in collect-build-traces and other
// phases) iterates entries under os.tmpdir() and runs in strict mode. When
// AppData\Local\Temp contains stray .tmp files from other processes (a normal
// state for a long-lived dev box), scandir on those files returns EACCES and
// glob aborts. The error then cascades through processAssets and surfaces as
// `FlightClientEntryPlugin.createActionAssets: Cannot read properties of
// undefined (reading 'server')` — a misleading symptom that has nothing to do
// with server actions.
//
// Pointing TEMP/TMP/TMPDIR at .build-tmp/ before spawning `next build` keeps
// the build's tooling inside a clean, isolated directory we own.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Only sandbox on Windows. On Linux/macOS the OS temp dir doesn't accumulate
// permission-denied .tmp files from other processes, and on Vercel /tmp is
// the expected scratch path for build tooling.
if (process.platform === 'win32') {
  const tmpDir = path.resolve(process.cwd(), '.build-tmp');
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }
  process.env.TEMP = tmpDir;
  process.env.TMP = tmpDir;
  process.env.TMPDIR = tmpDir;
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('with-local-tmp: missing command to run');
  process.exit(2);
}

const child = spawn(cmd, args, {
  env: process.env,
  shell: true,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
