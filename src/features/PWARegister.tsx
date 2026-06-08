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

    // @ts-ignore serwist is injected at runtime by @serwist/next (register: false)
    const serwist = window?.serwist;
    if (serwist?.register) {
      // best-effort registration; ignore errors
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      serwist.register().catch(() => {});
    }

    // Auto-reload once when a NEW service worker takes control, so a deploy never
    // leaves a client pinned to a stale JS bundle (root cause of the 2026-06 auth
    // lockout). Skip the first-install control acquisition, and guard against loops.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    // Proactively check for an updated SW on load and roughly hourly, so long-lived
    // tabs / installed PWAs pick up new deploys without a manual refresh.
    const checkForUpdate = () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update().catch(() => {}));
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
