import { memo, useEffect, useMemo, useRef } from 'react';

interface HTMLRendererProps {
  height?: string;
  htmlContent: string;
  width?: string;
}

/**
 * HTMLRenderer component for rendering HTML content in an iframe
 * Uses Blob URL approach for better ES6 module support and external script loading
 * This approach creates a proper document URL, avoiding srcDoc limitations
 * Auto-fixes common syntax errors in AI-generated HTML (e.g., missing 'import' keyword)
 */
const HTMLRenderer = memo<HTMLRendererProps>(({ htmlContent, width = '100%', height = '100%' }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Create blob URL from HTML content with auto-fixes
  const blobUrl = useMemo(() => {
    // Fix common AI-generated syntax errors
    let fixedContent = htmlContent;

    // Fix: "importGUI from" -> "import GUI from"
    fixedContent = fixedContent.replaceAll(/\bimportGUI\s+from\b/g, 'import GUI from');

    // Fix: "importX from" -> "import X from" (generic pattern)
    fixedContent = fixedContent.replaceAll(
      /\bimport([A-Z][\dA-Za-z]*)\s+from\b/g,
      'import $1 from',
    );

    // Inject error handler script to catch and log errors
    const errorHandlerScript = `
      <script>
        window.addEventListener('error', function(e) {
          console.error('[HTMLRenderer Error]', e.message, e.filename, e.lineno, e.colno);
        });
        window.addEventListener('unhandledrejection', function(e) {
          console.error('[HTMLRenderer Promise Rejection]', e.reason);
        });
      </script>
    `;

    // Inject error handler before closing </head> or at the beginning
    if (fixedContent.includes('</head>')) {
      fixedContent = fixedContent.replace('</head>', `${errorHandlerScript}</head>`);
    } else {
      fixedContent = errorHandlerScript + fixedContent;
    }

    const blob = new Blob([fixedContent], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [htmlContent]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  // Add iframe load handler for debugging
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      console.log('[HTMLRenderer] Iframe loaded successfully');
    };

    const handleError = () => {
      console.error('[HTMLRenderer] Iframe failed to load');
    };

    iframe.addEventListener('load', handleLoad);
    iframe.addEventListener('error', handleError);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      iframe.removeEventListener('error', handleError);
    };
  }, []);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts allow-same-origin allow-downloads"
      src={blobUrl}
      style={{ border: 'none', height, width }}
      title="html-renderer"
    />
  );
});

export default HTMLRenderer;
