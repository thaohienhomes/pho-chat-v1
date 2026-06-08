import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

// This declares the value of `injectionPoint` to TypeScript.
// `injectionPoint` is the string that will be replaced by the
// actual precache manifest. By default, this string is set to
// `"self.__SW_MANIFEST"`.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

// eslint-disable-next-line no-undef
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  clientsClaim: true,
  navigationPreload: true,
  precacheEntries: self.__SW_MANIFEST,
  runtimeCaching: defaultCache,
  skipWaiting: true,
});

serwist.addEventListeners();

// --- One-time recovery for clients trapped on a stale/poisoned service worker ---
// The 2026-06 auth incident pinned some clients to a stale JS bundle: a poisoned
// precache entry made every new SW install fail, so the client could never update
// and stopped attaching the Clerk token (→ 401 for logged-in paying users). #67
// fixed the poisoning for NEW installs, but already-trapped clients never reloaded
// onto the fix. When this worker activates, force each open window to reload once
// onto fresh assets — driven from the SW side, so it works regardless of the old
// page's bundle. A sentinel cache makes this run exactly once per RESET_TAG (no
// reload loop); bump the tag only if a forced reset is ever needed again.
const RESET_TAG = 'pho-sw-reset-2026-06-08';

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Single-shot guard: if we've already reset for this tag, do nothing.
      if (await caches.has(RESET_TAG)) return;
      await caches.open(RESET_TAG);

      // Take control of existing pages, then reload them through the fresh worker.
      await self.clients.claim();
      const windows = await self.clients.matchAll({
        includeUncontrolled: true,
        type: 'window',
      });
      await Promise.all(
        windows.map((client) =>
          'navigate' in client
            ? (client as WindowClient).navigate(client.url).catch(() => {})
            : Promise.resolve(),
        ),
      );
    })(),
  );
});
