import { CDN_ALLOWLIST, MORPHDOM_CDN_URL, STYLE_CDN_ALLOWLIST } from './constants';

export interface ShellThemeVars {
  accent: string;
  bg: string;
  border: string;
  surface: string;
  text: string;
  textSecondary: string;
}

// Dark mode CSS overrides (shared between shell and complete HTML)
const darkModeOverrides = `
    /* Ensure SVG text and axis labels use theme text color */
    svg text, svg .tick text, svg .label { fill: var(--color-text) !important; }
    svg line, svg .grid line, svg .domain, svg .axis line, svg .axis path { stroke: var(--color-border) !important; }
    svg circle.grid, svg polygon.grid, svg .gridline { stroke: var(--color-border) !important; fill: none !important; }
    table { border-color: var(--color-border); }
    th, td { border-color: var(--color-border) !important; color: var(--color-text); }
    th { background: var(--color-surface) !important; }
    input, select, textarea { color: var(--color-text); background: var(--color-surface); border-color: var(--color-border); }
    button { color: var(--color-text); border-color: var(--color-border); }
    button.active, button[aria-selected="true"], button[data-active], button[data-state="active"], button.selected, button.btn-primary, .tab-btn.active, .tab-button.active, [role="tab"][aria-selected="true"], [role="tab"].active { color: var(--color-bg) !important; }
    button:not(.active):not([aria-selected="true"]):not(.selected):not(.btn-primary):not([data-active]):not([data-state="active"]) { background: transparent; }
    progress { accent-color: var(--color-accent); }
    .progress-track, [class*="track"], [class*="bg-gray"] { background: var(--color-surface) !important; }
    a { color: var(--color-accent); }
    h1, h2, h3, h4, h5, h6, strong, b { color: var(--color-text); }
    canvas { display: block; }
`;

/**
 * Generates a streaming shell HTML that uses morphdom for smooth DOM diffing.
 *
 * During streaming, content is injected via postMessage → `_setContent(html)`.
 * morphdom diffs only changed DOM nodes: unchanged elements stay untouched,
 * new elements get a 0.3s fade-in animation. Scripts execute only when
 * `_runScripts()` is called after streaming completes.
 *
 * Architecture (from Claude.ai via pi-generative-ui):
 *  1. Shell opens with empty #root → morphdom loads from CDN
 *  2. Parent sends `updateContent` messages with partial HTML
 *  3. morphdom diffs #root against new HTML fragment
 *  4. On streaming complete, parent sends `finalizeContent` with full code
 *  5. morphdom does final diff + scripts re-execute
 */
export function generateStreamingShell(theme: ShellThemeVars): string {
  const scriptSrc = CDN_ALLOWLIST.join('\n      ');
  const styleSrc = STYLE_CDN_ALLOWLIST.join('\n      ');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'unsafe-inline' 'unsafe-eval'
      ${scriptSrc};
    style-src 'unsafe-inline'
      ${styleSrc};
    font-src https://fonts.gstatic.com;
    img-src data: blob: https:;
    connect-src https:;
  ">
  <style>
    :root {
      --color-bg: ${theme.bg};
      --color-text: ${theme.text};
      --color-text-secondary: ${theme.textSecondary};
      --color-border: ${theme.border};
      --color-accent: ${theme.accent};
      --color-surface: ${theme.surface};
    }
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--color-bg);
      color: var(--color-text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      overflow: hidden;
      line-height: 1.5;
    }
    @keyframes _fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: none; }
    }
    ${darkModeOverrides}
  </style>
</head>
<body>
  <div id="root"></div>

  <script>
    // ── Morphdom streaming state ──────────────────────────────────────────
    window._morphReady = false;
    window._pending = null;

    // Inject/diff content into #root using morphdom
    window._setContent = function(html) {
      if (!window._morphReady) {
        window._pending = html;
        return;
      }
      var root = document.getElementById('root');
      if (!root) return;
      var target = document.createElement('div');
      target.id = 'root';
      target.innerHTML = html;
      try {
        morphdom(root, target, {
          onBeforeElUpdated: function(from, to) {
            // Skip update if nodes are identical (perf optimization)
            if (from.isEqualNode(to)) return false;
            return true;
          },
          onNodeAdded: function(node) {
            // Fade-in animation for new elements (not styles/scripts)
            if (node.nodeType === 1 && node.tagName !== 'STYLE' && node.tagName !== 'SCRIPT') {
              node.style.animation = '_fadeIn 0.3s ease both';
            }
            return node;
          }
        });
      } catch (e) {
        // Fallback: direct innerHTML if morphdom fails
        root.innerHTML = html;
      }
    };

    // Re-execute all scripts in #root (called after streaming completes)
    window._runScripts = function() {
      var root = document.getElementById('root');
      if (!root) return;
      root.querySelectorAll('script').forEach(function(old) {
        var s = document.createElement('script');
        if (old.src) {
          s.src = old.src;
        } else {
          s.textContent = old.textContent;
        }
        // Copy attributes
        for (var i = 0; i < old.attributes.length; i++) {
          var attr = old.attributes[i];
          if (attr.name !== 'src') s.setAttribute(attr.name, attr.value);
        }
        old.parentNode.replaceChild(s, old);
      });
    };

    // ── Bridge functions ─────────────────────────────────────────────────
    window.sendPrompt = function(text) {
      window.parent.postMessage({ type: 'sendPrompt', text: text }, '*');
    };
    window.sendData = function(data) {
      window.parent.postMessage({ type: 'widgetData', data: data }, '*');
    };

    // Auto-sizing: report content height to parent on every resize
    new ResizeObserver(function(entries) {
      var height = entries[0].target.scrollHeight;
      window.parent.postMessage({ type: 'resize', height: height }, '*');
    }).observe(document.body);

    // Listen for messages from parent
    window.addEventListener('message', function(e) {
      var data = e.data;
      if (!data || typeof data.type !== 'string') return;

      // Streaming content update (morphdom diff)
      if (data.type === 'updateContent' && typeof data.html === 'string') {
        window._setContent(data.html);
        return;
      }

      // Final content + script execution
      if (data.type === 'finalizeContent' && typeof data.html === 'string') {
        window._setContent(data.html);
        window._runScripts();
        return;
      }

      // Theme update
      if (data.type === 'updateTheme' && data.vars && typeof data.vars === 'object') {
        Object.keys(data.vars).forEach(function(k) {
          document.documentElement.style.setProperty(k, data.vars[k]);
        });
      }

      // Export content (SVG preferred, fallback to HTML)
      if (data.type === 'exportContent') {
        var svg = document.querySelector('svg');
        if (svg) {
          window.parent.postMessage({
            type: 'exportedContent',
            format: 'svg',
            content: svg.outerHTML,
            title: data.title || 'visualization'
          }, '*');
        } else {
          window.parent.postMessage({
            type: 'exportedContent',
            format: 'html',
            content: document.getElementById('root').innerHTML,
            title: data.title || 'visualization'
          }, '*');
        }
      }
    });
  </script>

  <!-- Load morphdom for DOM diffing -->
  <script src="${MORPHDOM_CDN_URL}"
    onload="window._morphReady=true;if(window._pending){window._setContent(window._pending);window._pending=null;}"></script>
</body>
</html>`;
}

/**
 * Generates complete HTML with widget code embedded directly.
 * Used as the final state after streaming completes, or for non-streaming renders.
 *
 * This is the simplest possible approach:
 * - Widget code is embedded as-is inside the HTML body
 * - Scripts execute naturally during HTML parsing
 * - Only uses postMessage for: resize reporting, theme updates, sendPrompt bridge
 */
export function generateCompleteHTML(theme: ShellThemeVars, widgetCode: string): string {
  const scriptSrc = CDN_ALLOWLIST.join('\n      ');
  const styleSrc = STYLE_CDN_ALLOWLIST.join('\n      ');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'unsafe-inline' 'unsafe-eval'
      ${scriptSrc};
    style-src 'unsafe-inline'
      ${styleSrc};
    font-src https://fonts.gstatic.com;
    img-src data: blob: https:;
    connect-src https:;
  ">
  <style>
    :root {
      --color-bg: ${theme.bg};
      --color-text: ${theme.text};
      --color-text-secondary: ${theme.textSecondary};
      --color-border: ${theme.border};
      --color-accent: ${theme.accent};
      --color-surface: ${theme.surface};
    }
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--color-bg);
      color: var(--color-text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      overflow: hidden;
      line-height: 1.5;
    }
    ${darkModeOverrides}
  </style>
</head>
<body>
  ${widgetCode}

  <script>
    // Bridge: send a chat message from widget to parent
    window.sendPrompt = function(text) {
      window.parent.postMessage({ type: 'sendPrompt', text: text }, '*');
    };

    // Bridge: send interaction data from widget to parent
    window.sendData = function(data) {
      window.parent.postMessage({ type: 'widgetData', data: data }, '*');
    };

    // Auto-sizing: report content height to parent on every resize
    new ResizeObserver(function(entries) {
      var height = entries[0].target.scrollHeight;
      window.parent.postMessage({ type: 'resize', height: height }, '*');
    }).observe(document.body);

    // Listen for messages from parent (theme updates, export requests)
    window.addEventListener('message', function(e) {
      var data = e.data;
      if (!data || typeof data.type !== 'string') return;

      // Theme update
      if (data.type === 'updateTheme' && data.vars && typeof data.vars === 'object') {
        Object.keys(data.vars).forEach(function(k) {
          document.documentElement.style.setProperty(k, data.vars[k]);
        });
      }

      // Export content (SVG preferred, fallback to HTML)
      if (data.type === 'exportContent') {
        var svg = document.querySelector('svg');
        if (svg) {
          window.parent.postMessage({
            type: 'exportedContent',
            format: 'svg',
            content: svg.outerHTML,
            title: data.title || 'visualization'
          }, '*');
        } else {
          window.parent.postMessage({
            type: 'exportedContent',
            format: 'html',
            content: document.body.innerHTML,
            title: data.title || 'visualization'
          }, '*');
        }
      }
    });
  </script>
</body>
</html>`;
}
