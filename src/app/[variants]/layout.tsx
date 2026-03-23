import { SpeedInsights } from '@vercel/speed-insights/next';
import { ThemeAppearance } from 'antd-style';
import { ResolvingViewport } from 'next';
import Script from 'next/script';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { ReactNode } from 'react';
import { isRtlLang } from 'rtl-detect';

import Analytics from '@/components/Analytics';
import { DEFAULT_LANG } from '@/const/locale';
import { isDesktop } from '@/const/version';
import PWAInstall from '@/features/PWAInstall';
import AuthProvider from '@/layout/AuthProvider';
import GlobalProvider from '@/layout/GlobalProvider';
// VoiceSupport temporarily disabled for performance — Feb 2026
// import VoiceSupport from '@/features/VoiceSupport';
import { Locales } from '@/locales/resources';
import { DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

// Lifetime banner temporarily hidden — pending copy/pricing review
// const NewYearLifetimeBanner = nextDynamic(
//   () => import('@/features/PromotionBanner/NewYearLifetimeBanner'),
// );

// NOTE: force-dynamic REMOVED for performance — Feb 2026
// Clerk hooks only run in 'use client' components, they don't need force-dynamic.
// Removing this enables Vercel edge caching and ISR, dramatically improving TTFB and LCP.

const inVercel = process.env.VERCEL === '1';

interface RootLayoutProps extends DynamicLayoutProps {
  children: ReactNode;
  modal: ReactNode;
}

const RootLayout = async ({ children, params, modal }: RootLayoutProps) => {
  const { variants } = await params;

  const { locale, isMobile, theme, primaryColor, neutralColor } =
    RouteVariants.deserializeVariants(variants);

  const direction = isRtlLang(locale) ? 'rtl' : 'ltr';

  return (
    <html dir={direction} lang={locale}>
      <head>
        {/* === Critical Resource Hints — Improve FCP/LCP by parallelizing connections === */}
        {/* Clerk auth domain — loads ~200KB+ JS, preconnect saves ~200ms */}
        <link crossOrigin="anonymous" href="https://clerk.pho.chat" rel="preconnect" />
        <link href="https://clerk.pho.chat" rel="dns-prefetch" />
        {/* Clerk CDN for JS bundles */}
        <link crossOrigin="anonymous" href="https://cdn.clerk.com" rel="preconnect" />
        <link href="https://cdn.clerk.com" rel="dns-prefetch" />
        {/* Google Analytics */}
        <link crossOrigin="anonymous" href="https://www.googletagmanager.com" rel="preconnect" />
        <link href="https://www.googletagmanager.com" rel="dns-prefetch" />
        {/* Vercel Speed Insights */}
        <link href="https://va.vercel-scripts.com" rel="dns-prefetch" />

        {/* === Global Error Handlers (Mar 2026) === */}
        {/* 1. Stub zaloJSV2 for Zalo in-app browser */}
        {/* 2. Suppress benign ResizeObserver loop warnings */}
        {/* 3. Auto-reload on ChunkLoadError with multi-retry + backoff (Clerk CDN timeout fix) */}
        {/* 4. Gracefully handle unhandled tRPC promise rejections */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
if(typeof window!=='undefined'){
  // Stub zaloJSV2 with no-op methods for Zalo in-app browser
  if(!window.zaloJSV2)window.zaloJSV2={};
  if(typeof window.zaloJSV2.zalo_h5_event_handler!=='function'){
    window.zaloJSV2.zalo_h5_event_handler=function(){};
  }

  // Monkey-patch btoa to handle Unicode strings (Vietnamese text)
  var _origBtoa=window.btoa;
  window.btoa=function(s){
    try{return _origBtoa.call(window,s);}catch(e){
      if(e instanceof DOMException){
        var bytes=new TextEncoder().encode(s);
        var bin='';for(var i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
        return _origBtoa.call(window,bin);
      }
      throw e;
    }
  };

  // Multi-retry helper: allows up to 3 reloads with exponential backoff
  // Tracks per-page retries to handle Clerk CDN timeouts in slow regions (VN)
  function _chunkRetry(){
    var MAX=3,rk='__chunk_retries';
    try{
      var c=parseInt(sessionStorage.getItem(rk)||'0',10);
      if(c<MAX){
        sessionStorage.setItem(rk,String(c+1));
        var delay=Math.min(1000*Math.pow(2,c),8000);
        setTimeout(function(){window.location.reload();},delay);
        return true;
      }
    }catch(e){}
    return false;
  }

  // Global error handler
  var _origOnErr=window.onerror;
  window.onerror=function(m,src,line,col,err){
    // Suppress ResizeObserver noise
    if(typeof m==='string'&&m.indexOf('ResizeObserver')!==-1)return true;

    // Auto-reload on ChunkLoadError with multi-retry
    if(err&&(err.name==='ChunkLoadError'||
      (typeof m==='string'&&(m.indexOf('Loading chunk')!==-1||m.indexOf('Failed to fetch dynamically imported')!==-1)))){
      if(_chunkRetry())return true;
    }
    // Auto-reload on Clerk script load failure (clerk.pho.chat timeout)
    if(typeof m==='string'&&(m.indexOf('failed_to_load_clerk_js')!==-1||m.indexOf('Failed to load Clerk')!==-1)){
      if(_chunkRetry())return true;
    }
    return _origOnErr?_origOnErr.apply(window,arguments):false;
  };

  // Catch unhandled promise rejections (tRPC Failed to fetch, UNAUTHORIZED)
  window.addEventListener('unhandledrejection',function(e){
    var r=e&&e.reason;
    if(!r)return;
    var msg=r.message||'';
    // Auto-reload on chunk load promises with multi-retry
    if(r.name==='ChunkLoadError'||msg.indexOf('Loading chunk')!==-1){
      _chunkRetry();
      e.preventDefault();
      return;
    }
    // Auto-reload on Clerk script load failure (clerk.pho.chat timeout)
    if(msg.indexOf('failed_to_load_clerk_js')!==-1||msg.indexOf('Failed to load Clerk')!==-1){
      _chunkRetry();
      e.preventDefault();
      return;
    }
    // Suppress tRPC UNAUTHORIZED (expected during auth transitions)
    if(msg==='UNAUTHORIZED'&&r.constructor&&r.constructor.name==='TRPCClientError'){
      e.preventDefault();
      return;
    }
    // Suppress transient network errors (tRPC Failed to fetch)
    if(msg==='Failed to fetch'&&r.constructor&&r.constructor.name==='TRPCClientError'){
      e.preventDefault();
      return;
    }
  });

  // Clear retry counter on successful page load (all chunks loaded OK)
  window.addEventListener('load',function(){
    try{sessionStorage.removeItem('__chunk_retries');}catch(e){}
  });
}`,
          }}
        />
        {/* Google Site Verification */}
        {process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION && (
          <meta
            content={process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION}
            name="google-site-verification"
          />
        )}
        {process.env.DEBUG_REACT_SCAN === '1' && (
          // eslint-disable-next-line @next/next/no-sync-scripts
          <script crossOrigin="anonymous" src="https://unpkg.com/react-scan/dist/auto.global.js" />
        )}
      </head>
      <body>
        <NuqsAdapter>
          <GlobalProvider
            appearance={theme}
            isMobile={isMobile}
            locale={locale}
            neutralColor={neutralColor}
            primaryColor={primaryColor}
            variants={variants}
          >
            <AuthProvider>
              {children}
              {!isMobile && modal}
              {/* VoiceSupport temporarily disabled for performance — Feb 2026 */}
            </AuthProvider>
            <PWAInstall />
            {/* Lifetime banner temporarily hidden — pending copy/pricing review */}
            {/* <NewYearLifetimeBanner /> */}
          </GlobalProvider>
        </NuqsAdapter>
        <Analytics />
        {/* Google tag (gtag.js) - deferred to avoid blocking LCP */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=AW-17766075190"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'AW-17766075190');`}
        </Script>
        {inVercel && <SpeedInsights />}
      </body>
    </html>
  );
};

export default RootLayout;

export { generateMetadata } from './metadata';

export const generateViewport = async (props: DynamicLayoutProps): ResolvingViewport => {
  const isMobile = await RouteVariants.getIsMobile(props);

  const dynamicScale = isMobile ? { maximumScale: 1, userScalable: false } : {};

  return {
    ...dynamicScale,
    initialScale: 1,
    minimumScale: 1,
    themeColor: [
      { color: '#f8f8f8', media: '(prefers-color-scheme: light)' },
      { color: '#000', media: '(prefers-color-scheme: dark)' },
    ],
    viewportFit: 'cover',
    width: 'device-width',
  };
};

export const generateStaticParams = () => {
  const themes: ThemeAppearance[] = ['dark', 'light'];
  const mobileOptions = isDesktop ? [false] : [true, false];
  // only static for serveral page, other go to dynamtic
  const staticLocales: Locales[] = [DEFAULT_LANG, 'zh-CN'];

  const variants: { variants: string }[] = [];

  for (const locale of staticLocales) {
    for (const theme of themes) {
      for (const isMobile of mobileOptions) {
        variants.push({
          variants: RouteVariants.serializeVariants({ isMobile, locale, theme }),
        });
      }
    }
  }

  return variants;
};
