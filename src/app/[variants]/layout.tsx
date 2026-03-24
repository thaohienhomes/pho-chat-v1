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
        {/* HarmonyOS Sans font — preload Regular weight to eliminate FOIT and improve LCP */}
        <link
          as="font"
          crossOrigin="anonymous"
          href="https://registry.npmmirror.com/@lobehub/webfont-harmony-sans/1.0.0/files/fonts/HarmonyOS_Sans_Regular.woff2"
          rel="preload"
          type="font/woff2"
        />
        {/* Font CDN preconnect — saves DNS+TLS (~100-200ms) for font + Medium/Bold weights */}
        <link crossOrigin="anonymous" href="https://registry.npmmirror.com" rel="preconnect" />
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

        {/* Global error handlers: zaloJSV2 stub, btoa Unicode fix, ChunkLoadError retry, tRPC suppression */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(typeof window!=='undefined'){if(!window.zaloJSV2)window.zaloJSV2={};if(typeof window.zaloJSV2.zalo_h5_event_handler!=='function')window.zaloJSV2.zalo_h5_event_handler=function(){};var _b=window.btoa;window.btoa=function(s){try{return _b.call(window,s)}catch(e){if(e instanceof DOMException){var b=new TextEncoder().encode(s),r='';for(var i=0;i<b.length;i++)r+=String.fromCharCode(b[i]);return _b.call(window,r)}throw e}};function _cr(){var M=3,k='__chunk_retries';try{var c=parseInt(sessionStorage.getItem(k)||'0',10);if(c<M){sessionStorage.setItem(k,String(c+1));setTimeout(function(){location.reload()},Math.min(1e3*Math.pow(2,c),8e3));return true}}catch(e){}return false}var _oe=window.onerror;window.onerror=function(m,s,l,c,e){if(typeof m==='string'&&m.indexOf('ResizeObserver')!==-1)return true;if(e&&(e.name==='ChunkLoadError'||(typeof m==='string'&&(m.indexOf('Loading chunk')!==-1||m.indexOf('Failed to fetch dynamically')!==-1))))if(_cr())return true;if(typeof m==='string'&&(m.indexOf('failed_to_load_clerk')!==-1||m.indexOf('Failed to load Clerk')!==-1))if(_cr())return true;return _oe?_oe.apply(window,arguments):false};window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;if(!r)return;var m=r.message||'';if(r.name==='ChunkLoadError'||m.indexOf('Loading chunk')!==-1){_cr();e.preventDefault();return}if(m.indexOf('failed_to_load_clerk')!==-1||m.indexOf('Failed to load Clerk')!==-1){_cr();e.preventDefault();return}if((m==='UNAUTHORIZED'||m==='Failed to fetch')&&r.constructor&&r.constructor.name==='TRPCClientError'){e.preventDefault();return}});window.addEventListener('load',function(){try{sessionStorage.removeItem('__chunk_retries')}catch(e){}})}`,
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
        {/* Google tag (gtag.js) - lazyOnload: loads during browser idle, reduces TBT */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=AW-17766075190"
          strategy="lazyOnload"
        />
        <Script id="gtag-init" strategy="lazyOnload">
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
