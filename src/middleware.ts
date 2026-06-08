import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { parseDefaultThemeFromCountry } from '@lobechat/utils/server';
import debug from 'debug';
import { NextRequest, NextResponse } from 'next/server';
// UAParser replaced with lightweight regex — saves ~3ms/request at edge
import urlJoin from 'url-join';

import { OAUTH_AUTHORIZED } from '@/const/auth';
import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { LOBE_THEME_APPEARANCE } from '@/const/theme';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import NextAuth from '@/libs/next-auth';
import { Locales } from '@/locales/resources';

import { oidcEnv } from './envs/oidc';
import { parseBrowserLanguage } from './utils/locale';
import { RouteVariants } from './utils/server/routeVariants';

// Create debug logger instances
const logDefault = debug('middleware:default');
const logNextAuth = debug('middleware:next-auth');
const logClerk = debug('middleware:clerk');

// OIDC session pre-sync constant
const OIDC_SESSION_HEADER = 'x-oidc-session-sync';

export const config = {
  matcher: [
    // include any files in the api or trpc folders that might have an extension
    '/(api|trpc|webapi)(.*)',
    // include the /
    '/',
    '/discover',
    '/discover(.*)',
    '/chat',
    '/chat(.*)',
    '/changelog(.*)',
    '/settings(.*)',
    '/subscription(.*)',
    '/payment(.*)',
    '/image',
    '/files',
    '/files(.*)',
    '/repos(.*)',
    '/profile(.*)',
    '/me',
    '/me(.*)',
    '/apps',
    '/apps(.*)',
    '/share',
    '/share(.*)',

    '/onboard',
    '/onboard(.*)',
    '/login(.*)',
    '/signup(.*)',
    '/next-auth/(.*)',
    '/oauth(.*)',
    '/oidc(.*)',
    '/admin',
    '/admin(.*)',

    // Custom Phở Chat pages
    '/models',
    '/usage',
    '/invite',
    '/affiliate',
    // ↓ cloud ↓
  ],
};

const backendApiEndpoints = ['/api', '/trpc', '/webapi', '/oidc'];

const defaultMiddleware = (request: NextRequest) => {
  const url = new URL(request.url);

  // Security: Block .env file probing (e.g. /api/.env.local, /admin/.env.prod)
  if (/\/\.env(\.|$)/i.test(url.pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  logDefault('Processing request: %s %s', request.method, request.url);

  // skip all api requests
  if (backendApiEndpoints.some((path) => url.pathname.startsWith(path))) {
    logDefault('Skipping API request: %s', url.pathname);
    return NextResponse.next();
  }

  // 1. Read user preferences from cookies
  const theme =
    request.cookies.get(LOBE_THEME_APPEARANCE)?.value || parseDefaultThemeFromCountry(request);

  // locale has three levels
  // 1. search params
  // 2. cookie
  // 3. browser

  // highest priority is explicitly in search params, like ?hl=zh-CN
  const explicitlyLocale = (url.searchParams.get('hl') || undefined) as Locales | undefined;

  // if it's a new user, there's no cookie, So we need to use the fallback language parsed by accept-language
  const browserLanguage = parseBrowserLanguage(request.headers);

  const locale =
    explicitlyLocale ||
    ((request.cookies.get(LOBE_LOCALE_COOKIE)?.value || browserLanguage) as Locales);

  const ua = request.headers.get('user-agent') || '';

  const isMobileUA = /mobile|android|iphone|ipad|ipod|webos|blackberry|opera mini|iemobile/i.test(ua);
  const device = { type: isMobileUA ? 'mobile' : undefined };

  logDefault('User preferences: %O', {
    browserLanguage,
    deviceType: device.type,
    hasCookies: {
      locale: !!request.cookies.get(LOBE_LOCALE_COOKIE)?.value,
      theme: !!request.cookies.get(LOBE_THEME_APPEARANCE)?.value,
    },
    locale,
    theme,
  });

  // 2. Create normalized preference values
  const route = RouteVariants.serializeVariants({
    isMobile: device.type === 'mobile',
    locale,
    theme,
  });

  logDefault('Serialized route variant: %s', route);

  // if app is in docker, rewrite to self container
  // https://github.com/lobehub/lobe-chat/issues/5876
  if (appEnv.MIDDLEWARE_REWRITE_THROUGH_LOCAL) {
    logDefault('Local container rewrite enabled: %O', {
      host: '127.0.0.1',
      original: url.toString(),
      port: process.env.PORT || '3210',
      protocol: 'http',
    });

    url.protocol = 'http';
    url.host = '127.0.0.1';
    url.port = process.env.PORT || '3210';
  }

  // refs: https://github.com/lobehub/lobe-chat/pull/5866
  // new handle segment rewrite: /${route}${originalPathname}
  // / -> /zh-CN__0__dark
  // /discover -> /zh-CN__0__dark/discover
  const nextPathname = `/${route}` + (url.pathname === '/' ? '' : url.pathname);
  const nextURL = appEnv.MIDDLEWARE_REWRITE_THROUGH_LOCAL
    ? urlJoin(url.origin, nextPathname)
    : nextPathname;

  logDefault('URL rewrite: %O', {
    isLocalRewrite: appEnv.MIDDLEWARE_REWRITE_THROUGH_LOCAL,
    nextPathname: nextPathname,
    nextURL: nextURL,
    originalPathname: url.pathname,
  });

  url.pathname = nextPathname;

  return NextResponse.rewrite(url, { status: 200 });
};

const isPublicRoute = createRouteMatcher([
  // backend api
  '/api/auth(.*)',
  '/api/webhooks(.*)',
  '/api/healthcheck(.*)',
  // Payment webhooks (must be public for payment providers to call)
  '/api/payment/sepay/webhook',
  '/api/payment/polar/webhook',
  '/api/sepay/webhook',
  // Cron jobs (authenticated via CRON_SECRET header, not user session)
  '/api/cron(.*)',
  // Geo-detection API (needed for pricing display before auth)
  '/api/pricing/geo',
  '/webapi(.*)',
  '/trpc(.*)',
  // next auth
  '/next-auth/(.*)',
  // clerk - include OAuth callback routes
  '/login',
  '/login(.*)',
  '/signup',
  '/signup(.*)',
  '/sso-callback',
  '/sso-callback(.*)',
  // oauth
  '/oidc/handoff',
  '/oidc/token',
  // public share
  '/share(.*)',
  // public chat interface - allows unauthenticated users to view chat UI
  // (message sending is blocked in the frontend until authenticated)
  '/',
  '/chat',
  '/chat(.*)',
  // discover page - public browsing
  '/discover',
  '/discover(.*)',
  // Lifetime deal pages
  '/lifetime',
  '/lifetime(.*)',
  // Onboarding page - needs to load for first-time users
  // Auth is enforced at TRPC layer for data mutations
  '/onboard',
  '/onboard(.*)',
  // Subscription APIs - allow public access for checking allowed models
  '/api/subscription(.*)',
  // Payment checkout
  '/api/payment(.*)',
  // Public pages
  '/models',
  // Subscription checkout & plans - must be public so landing page CTAs work
  // Auth is handled at component level via Clerk's useUser() hook
  '/subscription/checkout',
  '/subscription/plans',
  // Public API endpoints
  '/api/health',
  '/api/v1(.*)',
  '/api/plugins(.*)',
  // Document translation API (auth handled via server-side API keys)
  '/api/document-translation(.*)',
  // Research mode API (auth handled internally via Clerk auth())
  '/api/research(.*)',
]);

const isProtectedRoute = createRouteMatcher([
  '/settings(.*)',
  '/files(.*)',
  '/oauth(.*)',
  // ↓ cloud ↓
]);

// Initialize an Edge compatible NextAuth middleware
const nextAuthMiddleware = NextAuth.auth((req) => {
  logNextAuth('NextAuth middleware processing request: %s %s', req.method, req.url);

  const response = defaultMiddleware(req);

  // when enable auth protection, only public route is not protected, others are all protected
  const isProtected = appEnv.ENABLE_AUTH_PROTECTION ? !isPublicRoute(req) : isProtectedRoute(req);

  logNextAuth('Route protection status: %s, %s', req.url, isProtected ? 'protected' : 'public');

  // Just check if session exists
  const session = req.auth;

  // Check if next-auth throws errors
  // refs: https://github.com/lobehub/lobe-chat/pull/1323
  const isLoggedIn = !!session?.expires;

  logNextAuth('NextAuth session status: %O', {
    expires: session?.expires,
    isLoggedIn,
    userId: session?.user?.id,
  });

  // Remove & amend OAuth authorized header
  response.headers.delete(OAUTH_AUTHORIZED);
  if (isLoggedIn) {
    logNextAuth('Setting auth header: %s = %s', OAUTH_AUTHORIZED, 'true');
    response.headers.set(OAUTH_AUTHORIZED, 'true');

    // If OIDC is enabled and user is logged in, add OIDC session pre-sync header
    if (oidcEnv.ENABLE_OIDC && session?.user?.id) {
      logNextAuth('OIDC session pre-sync: Setting %s = %s', OIDC_SESSION_HEADER, session.user.id);
      response.headers.set(OIDC_SESSION_HEADER, session.user.id);
    }
  } else {
    // If request a protected route, redirect to sign-in page
    // ref: https://authjs.dev/getting-started/session-management/protecting
    if (isProtected) {
      logNextAuth('Request a protected route, redirecting to sign-in page');
      const nextLoginUrl = new URL('/next-auth/signin', req.nextUrl.origin);
      nextLoginUrl.searchParams.set('callbackUrl', req.nextUrl.href);
      return Response.redirect(nextLoginUrl);
    }
    logNextAuth('Request a free route but not login, allow visit without auth header');
  }

  return response;
});

const clerkAuthMiddleware = clerkMiddleware(
  async (auth, req) => {
    try {
      logClerk('Clerk middleware processing request: %s %s', req.method, req.url);

      // when enable auth protection, only public route is not protected, others are all protected
      const isProtected = appEnv.ENABLE_AUTH_PROTECTION
        ? !isPublicRoute(req)
        : isProtectedRoute(req);

      logClerk('Route protection status: %s, %s', req.url, isProtected ? 'protected' : 'public');

      // Only call auth() when the route is protected or OIDC needs session info
      // For public routes without OIDC, skip the Clerk API round-trip entirely
      if (isProtected) {
        logClerk('Protecting route: %s', req.url);
        await auth.protect();
      }

      // Create the response after auth checks
      const response = defaultMiddleware(req);

      // If OIDC is enabled, resolve auth to set session header
      if (oidcEnv.ENABLE_OIDC) {
        const data = await auth();
        if (data.userId) {
          logClerk('OIDC session pre-sync: Setting %s = %s', OIDC_SESSION_HEADER, data.userId);
          response.headers.set(OIDC_SESSION_HEADER, data.userId);
        }
      }

      return response;
    } catch (error) {
      // Next.js signals 404 (notFound) and redirects by THROWING a control-flow
      // "error" carrying a `digest` like `NEXT_HTTP_ERROR_FALLBACK;404` or
      // `NEXT_REDIRECT;...`. These are expected outcomes — e.g. an unauthenticated
      // user hitting a protected route (auth.protect() → redirect to /login), or a
      // request for a non-existent page (/medical-beta-guide.html → 404). Logging
      // them as errors floods the dashboard (~20+/8h) and buries real failures.
      // Re-throw them silently so Next/Clerk handle them normally; only log genuine errors.
      const digest = (error as { digest?: unknown } | null)?.digest;
      const isNextControlFlow =
        typeof digest === 'string' &&
        (digest.startsWith('NEXT_REDIRECT') ||
          digest.startsWith('NEXT_HTTP_ERROR_FALLBACK') ||
          digest.startsWith('NEXT_NOT_FOUND'));
      if (!isNextControlFlow) {
        logClerk('Clerk middleware error: %O', error);
        console.error('Clerk middleware error:', error);
      }
      // Re-throw to let Clerk/Next handle the error (e.g., redirect to login, render 404)
      throw error;
    }
  },
  {
    // https://github.com/lobehub/lobe-chat/pull/3084
    clockSkewInMs: 60 * 60 * 1000,
    signInUrl: '/login',
    signUpUrl: '/signup',
  },
);

logDefault('Middleware configuration: %O', {
  enableAuthProtection: appEnv.ENABLE_AUTH_PROTECTION,
  enableClerk: authEnv.NEXT_PUBLIC_ENABLE_CLERK_AUTH,
  enableNextAuth: authEnv.NEXT_PUBLIC_ENABLE_NEXT_AUTH,
  enableOIDC: oidcEnv.ENABLE_OIDC,
});

export default authEnv.NEXT_PUBLIC_ENABLE_CLERK_AUTH
  ? clerkAuthMiddleware
  : authEnv.NEXT_PUBLIC_ENABLE_NEXT_AUTH
    ? nextAuthMiddleware
    : defaultMiddleware;
