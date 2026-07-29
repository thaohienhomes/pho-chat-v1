'use client';

import { useEffect } from 'react';

const PWARegister = () => {
  useEffect(() => {
    // only run in production browsers with service worker support
    if (
      typeof window === 'undefined' ||
      process.env.NODE_ENV !== 'production' ||
      !('serviceWorker' in navigator)
    ) {
      return;
    }

    // window.serwist is injected at runtime by @serwist/next (register: false).
    // Type it locally so we don't need a @ts-ignore or a global augmentation.
    const serwist = (window as unknown as { serwist?: { register?: () => Promise<unknown> } })
      .serwist;
    if (serwist?.register) {
      // best-effort registration; log failures so SW rollout issues stay diagnosable
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      serwist.register().catch((error: unknown) => {
        console.error('[pwa] service worker registration failed', error);
      });
    }

    // Auto-reload once when a NEW service worker takes control, so a deploy never
    // leaves a client pinned to a stale JS bundle (root cause of the 2026-06 auth
    // lockout). The first controllerchange in a session that started without a
    // controller is the initial acquisition (first install), not an update — skip
    // it, then reload on any later takeover. `reloading` guards against loops.
    let hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      if (!hadController) {
        hadController = true;
        return;
      }
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    // Proactively check for an updated SW on load and roughly hourly, so long-lived
    // tabs / installed PWAs pick up new deploys without a manual refresh.
    const checkForUpdate = () => {
      // Use `ready` (resolves once a registration is active) rather than
      // getRegistration(), so the on-load check isn't a no-op when it races with
      // the initial register() on a first visit.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      navigator.serviceWorker.ready
        .then((reg) =>
          reg.update().catch((error: unknown) => {
            console.error('[pwa] service worker update check failed', error);
          }),
        )
        .catch((error: unknown) => {
          console.error('[pwa] service worker ready failed', error);
        });
    };
    checkForUpdate();
    const interval = window.setInterval(checkForUpdate, 60 * 60 * 1000);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      window.clearInterval(interval);
    };
  }, []);

  return null;
};

export default PWARegister;
