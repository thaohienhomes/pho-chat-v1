#!/usr/bin/env node
/**
 * autoresearch bundle measurement script
 *
 * Builds the project and measures:
 * - js_bundle_kb: total .js file size in .next/static
 * - total_bundle_kb: total .next/static size
 * - chunk_count: number of .js files
 * - build_seconds: wall-clock build time
 *
 * Outputs METRIC lines for the autoresearch loop.
 * Cross-platform: works on Windows (pnpm) + Linux.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STATIC_DIR = join(ROOT, '.next', 'static');

// PHO-258: On Windows, sandbox the build's temp dir to a project-local path
// so the build doesn't trip on stray .tmp files in AppData\Local\Temp. See
// scripts/with-local-tmp.mjs for the full explanation.
const BUILD_TMP = join(ROOT, '.build-tmp');
if (process.platform === 'win32' && !existsSync(BUILD_TMP)) {
  mkdirSync(BUILD_TMP, { recursive: true });
}
const TMP_OVERRIDE =
  process.platform === 'win32' ? { TEMP: BUILD_TMP, TMP: BUILD_TMP, TMPDIR: BUILD_TMP } : {};

/**
 * Recursively collect all files in a directory
 */
function walkDir(dir) {
  let results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch {
    // directory doesn't exist
  }
  return results;
}

/**
 * Find the actual next CLI binary in pnpm store or fallback
 */
function findNextBin() {
  // Try 1: direct node_modules/.bin (works on npm/yarn and some pnpm setups)
  const dotBin = join(ROOT, 'node_modules', '.bin', 'next');

  // Try 2: resolve next/dist/bin/next from pnpm store
  const pnpmDir = join(ROOT, 'node_modules', '.pnpm');
  if (existsSync(pnpmDir)) {
    try {
      // Walk pnpm store to find next@*/node_modules/next/dist/bin/next
      const pnpmEntries = readdirSync(pnpmDir);
      for (const entry of pnpmEntries) {
        if (entry.startsWith('next@')) {
          const candidate = join(pnpmDir, entry, 'node_modules', 'next', 'dist', 'bin', 'next');
          if (existsSync(candidate)) {
            return `node "${candidate}"`;
          }
        }
      }
    } catch {}
  }

  // Try 3: standard node_modules/next
  const standard = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (existsSync(standard)) {
    return `node "${standard}"`;
  }

  // Fallback: use .bin shim (may work on some systems)
  return `"${dotBin}"`;
}

// ---------- Build ----------
console.log('Building...');
const buildStart = Date.now();

const nextCmd = findNextBin();
console.log(`Using: ${nextCmd} build`);

try {
  execSync(`${nextCmd} build`, {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: '--max-old-space-size=8192',
      UPLOAD_SOURCEMAPS: '0',
      ...TMP_OVERRIDE,
    },
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 20 * 60 * 1000, // 20 min max
  });
} catch (err) {
  console.error('BUILD FAILED');
  const stderr = err.stderr?.toString() || '';
  const stdout = err.stdout?.toString() || '';
  console.error((stderr + '\n' + stdout).trim().split('\n').slice(-30).join('\n'));
  process.exit(1);
}

const buildSeconds = ((Date.now() - buildStart) / 1000).toFixed(2);

// ---------- Measure ----------
const allFiles = walkDir(STATIC_DIR);

const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
const jsKb = jsFiles.reduce((sum, f) => sum + statSync(f).size, 0) / 1024;
const totalKb = allFiles.reduce((sum, f) => sum + statSync(f).size, 0) / 1024;

// ---------- Output ----------
console.log(`METRIC js_bundle_kb=${Math.round(jsKb)}`);
console.log(`METRIC total_bundle_kb=${Math.round(totalKb)}`);
console.log(`METRIC chunk_count=${jsFiles.length}`);
console.log(`METRIC build_seconds=${buildSeconds}`);
