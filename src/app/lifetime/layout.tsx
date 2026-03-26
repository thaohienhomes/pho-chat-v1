import { Metadata } from 'next';
import { PropsWithChildren } from 'react';

export const metadata: Metadata = {
  description:
    'No more monthly subscriptions for AI chat. Pay once, own Pho.chat forever with lifetime access to all premium AI models including GPT-4, Claude, and more.',
  icons: {
    apple: '/apple-touch-icon.png',
    icon: '/favicon.ico',
    shortcut: '/favicon-32x32.ico',
  },
  title: 'Lifetime Deal | Pho.chat - Own Your AI Forever',
};

const LifetimeRootLayout = ({ children }: PropsWithChildren) => {
  return (
    <html lang="en">
      <head>
        {/* Preconnect for faster Google Fonts loading */}
        <link crossOrigin="anonymous" href="https://fonts.googleapis.com" rel="preconnect" />
        <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
        {/* Google Fonts - Inter */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        {/* Google tag (gtag.js) */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=AW-17766075190" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'AW-17766075190');
            `,
          }}
        />
      </head>
      <body
        style={{
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          margin: 0,
          padding: 0,
        }}
      >
        <div
          style={{
            background: '#0a0a0a',
            color: '#fff',
            minHeight: '100vh',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
        </div>
      </body>
    </html>
  );
};

export default LifetimeRootLayout;
