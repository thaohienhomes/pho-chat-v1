#!/usr/bin/env node
/**
 * Upload sourcemaps to PostHog for error tracking.
 *
 * Requires UPLOAD_SOURCEMAPS=1 to be set during build (generates .map files)
 * and POSTHOG_PERSONAL_API_KEY to authenticate the upload.
 *
 * Usage (in CI/CD or locally after build):
 *   UPLOAD_SOURCEMAPS=1 npm run build
 *   node scripts/upload-sourcemaps.mjs
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const POSTHOG_HOST = 'https://us.posthog.com';
const POSTHOG_PROJECT_ID = '306983';

const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
if (!apiKey) {
  console.log('[sourcemaps] POSTHOG_PERSONAL_API_KEY not set — skipping upload');
  process.exit(0);
}

const chunksDir = resolve('.next/static/chunks');
if (!existsSync(chunksDir)) {
  console.error('[sourcemaps] .next/static/chunks not found — did you run `next build`?');
  process.exit(1);
}

// Get current git revision for release tagging
let release = 'unknown';
try {
  release = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // Fall back to timestamp
  release = `build-${Date.now()}`;
}

console.log(`[sourcemaps] Uploading sourcemaps to PostHog (release: ${release})...`);

try {
  execSync(
    [
      'npx @posthog/cli sourcemaps upload',
      `--api-key ${apiKey}`,
      `--host ${POSTHOG_HOST}`,
      `--project-id ${POSTHOG_PROJECT_ID}`,
      `--release ${release}`,
      '.next/static/',
    ].join(' '),
    { stdio: 'inherit' },
  );
  console.log('[sourcemaps] Upload complete.');
} catch (e) {
  console.error('[sourcemaps] Upload failed:', e.message);
  // Don't fail the build — sourcemaps are nice-to-have
  process.exit(0);
}
