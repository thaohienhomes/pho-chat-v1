/**
 * Builds the full HTML document for the React artifact iframe renderer.
 *
 * Loads React, Babel standalone, Tailwind, and common libraries via CDN.
 * User code is base64-encoded to avoid HTML escaping issues, then decoded
 * and compiled in-browser using Babel standalone with env+react+typescript presets.
 *
 * A `require()` shim maps package names to CDN-loaded globals, with functional
 * stubs for libraries without UMD builds (lucide-react, framer-motion, Radix UI).
 */

// Encode string to base64, handling full Unicode correctly
export function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('');
  return btoa(binString);
}

// Strip <lobeArtifact> wrapper tags if they leaked through the selector layer
const ARTIFACT_WRAPPER_RE = /^\s*<lobeArtifact\b[^>]*>([\S\s]*?)(?:<\/lobeArtifact>\s*)?$/;
export function stripArtifactWrapper(code: string): string {
  const match = code.match(ARTIFACT_WRAPPER_RE);
  return match ? match[1].trim() : code;
}

export function buildIframeHtml(encodedCode: string, title: string, identifier?: string): string {
  const safeTitle = title.replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const safeIdentifier = (identifier || 'default').replaceAll('"', '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    html, body, #root { height: 100%; margin: 0; padding: 0; background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    * { box-sizing: border-box; }
    @keyframes _spin { to { transform: rotate(360deg) } }
    ._loader { display:flex; align-items:center; justify-content:center; height:100%; flex-direction:column; gap:12px; }
    ._loader-ring { width:28px; height:28px; border:2px solid rgba(148,163,184,0.2); border-top-color:#60a5fa; border-radius:50%; animation:_spin 1s linear infinite; }
    ._loader-text { color:#94a3b8; font-size:13px; }
  </style>

  <!-- React 18 -->
  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>

  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- Babel Standalone (JSX + TS + import/export compilation) -->
  <script src="https://unpkg.com/@babel/standalone@7/babel.min.js" crossorigin></script>

  <!-- Recharts (data visualization) -->
  <script src="https://unpkg.com/recharts@2.15.3/umd/Recharts.js" crossorigin></script>

  <!-- D3 -->
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js" crossorigin></script>

  <!-- KaTeX -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" crossorigin></script>

  <!-- Three.js -->
  <script src="https://unpkg.com/three@0.170.0/build/three.min.js" crossorigin></script>

  <!-- Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" crossorigin></script>
</head>
<body>
  <div id="root">
    <div class="_loader"><div class="_loader-ring"></div><div class="_loader-text">Building preview…</div></div>
  </div>

  <!-- User code encoded as base64 to avoid HTML injection / escaping issues -->
  <script id="_artifact_code" type="text/plain">${encodedCode}</script>

  <script>
  (function() {
    "use strict";

    // ── CommonJS module shim ───────────────────────────────────────────
    var module = { exports: {} };
    var exports = module.exports;

    // ── Utility stubs ──────────────────────────────────────────────────

    function clsx() {
      var result = [];
      for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];
        if (!arg) continue;
        if (typeof arg === 'string' || typeof arg === 'number') result.push(arg);
        else if (Array.isArray(arg)) result.push(clsx.apply(null, arg));
        else if (typeof arg === 'object') {
          for (var key in arg) { if (arg[key]) result.push(key); }
        }
      }
      return result.join(' ');
    }

    function twMerge() {
      return Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
    }

    function cva(base, config) {
      return function(props) {
        var classes = [base];
        if (config && config.variants && props) {
          Object.keys(config.variants).forEach(function(key) {
            var val = props[key] || (config.defaultVariants && config.defaultVariants[key]);
            if (val && config.variants[key][val]) classes.push(config.variants[key][val]);
          });
        }
        return classes.filter(Boolean).join(' ');
      };
    }

    // ── lucide-react proxy (returns placeholder SVG icon components) ───
    var lucideReactProxy = new Proxy({}, {
      get: function(_, name) {
        if (name === '__esModule') return true;
        if (name === 'default') return {};
        return function LucideIcon(props) {
          var s = (props && props.size) || 24;
          var c = (props && props.color) || 'currentColor';
          return React.createElement('svg', {
            width: s, height: s, viewBox: '0 0 24 24',
            fill: 'none', stroke: c, strokeWidth: 2,
            strokeLinecap: 'round', strokeLinejoin: 'round',
            className: (props && props.className) || '',
            style: props && props.style
          },
            React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
            React.createElement('text', {
              x: 12, y: 16, textAnchor: 'middle', fontSize: 8,
              fill: c, stroke: 'none'
            }, typeof name === 'string' ? name.slice(0, 3) : '?')
          );
        };
      }
    });

    // ── framer-motion stubs ────────────────────────────────────────────
    var motionProxy = new Proxy({}, {
      get: function(_, tag) {
        var MOTION_PROPS = ['animate','initial','exit','transition','variants',
          'whileHover','whileTap','whileInView','whileFocus','whileDrag',
          'drag','dragConstraints','dragElastic','layout','layoutId',
          'onAnimationStart','onAnimationComplete'];
        return React.forwardRef(function(props, ref) {
          var clean = {};
          Object.keys(props).forEach(function(k) {
            if (MOTION_PROPS.indexOf(k) === -1) clean[k] = props[k];
          });
          clean.ref = ref;
          return React.createElement(tag, clean);
        });
      }
    });

    function AnimatePresence(props) { return props.children || null; }

    // ── Radix UI stub factory ──────────────────────────────────────────
    function createRadixStub() {
      return new Proxy({}, {
        get: function(_, name) {
          if (name === '__esModule') return true;
          return function RadixStub(props) {
            return React.createElement('div', {
              className: props && props.className,
              style: props && props.style
            }, props && props.children);
          };
        }
      });
    }

    // ── react-katex stubs ──────────────────────────────────────────────
    var reactKatex = {
      InlineMath: function(props) {
        return React.createElement('span', { ref: function(el) {
          if (el && window.katex) {
            try { window.katex.render(props.math || '', el); }
            catch(e) { el.textContent = props.math || ''; }
          }
        }});
      },
      BlockMath: function(props) {
        return React.createElement('div', { ref: function(el) {
          if (el && window.katex) {
            try { window.katex.render(props.math || '', el, { displayMode: true }); }
            catch(e) { el.textContent = props.math || ''; }
          }
        }});
      }
    };

    // ── @react-three stubs ─────────────────────────────────────────────
    var reactThreeFiber = {
      Canvas: function(props) {
        return React.createElement('div', {
          style: Object.assign({ width: '100%', height: '100%', background: '#1a1a2e' }, props.style),
          className: props && props.className
        }, props && props.children);
      },
      useFrame: function() {},
      useThree: function() { return {}; },
      extend: function() {}
    };

    var reactThreeDrei = new Proxy({}, {
      get: function(_, name) {
        if (name === '__esModule') return true;
        return function(props) { return (props && props.children) || null; };
      }
    });

    // ── require() shim ─────────────────────────────────────────────────
    var moduleMap = {
      'react': React,
      'react-dom': ReactDOM,
      'react-dom/client': { createRoot: ReactDOM.createRoot.bind(ReactDOM) },
      'recharts': window.Recharts || {},
      'd3': window.d3 || {},
      'lucide-react': lucideReactProxy,
      'framer-motion': {
        motion: motionProxy,
        AnimatePresence: AnimatePresence,
        useAnimation: function() { return { start: function(){} }; },
        useInView: function() { return false; },
        useScroll: function() { return { scrollYProgress: { current: 0 } }; },
        useTransform: function() { return 0; },
        useMotionValue: function(v) { return { get: function(){return v;}, set: function(){} }; },
        useSpring: function(v) { return v; }
      },
      'clsx': { default: clsx, clsx: clsx },
      'tailwind-merge': { twMerge: twMerge },
      'class-variance-authority': { cva: cva },
      'katex': window.katex || {},
      'react-katex': reactKatex,
      'three': window.THREE || {},
      '@react-three/fiber': reactThreeFiber,
      '@react-three/drei': reactThreeDrei,
      '@react-spring/three': {
        useSpring: function() { return [{}, function(){}]; },
        animated: new Proxy({}, { get: function(_, t) { return t; } })
      },
      'chart.js': window.Chart || {},
      'chart.js/auto': window.Chart || {}
    };

    function require(mod) {
      if (moduleMap[mod]) return moduleMap[mod];
      if (mod.startsWith('@radix-ui/')) return createRadixStub();
      console.warn('[Artifact] Module "' + mod + '" not available — returning stub');
      return new Proxy({}, {
        get: function(_, name) {
          if (name === '__esModule') return true;
          if (name === 'default') return function(props) { return (props && props.children) || null; };
          return function(props) { return (props && props.children) || null; };
        }
      });
    }

    // ── Pho.Chat SDK: window.phoChat ─────────────────────────────────
    var _AID = "${safeIdentifier}";
    window.phoChat = {
      storage: {
        get: function(key) {
          try {
            var raw = localStorage.getItem('artifact:' + _AID + ':' + key);
            return raw ? JSON.parse(raw) : null;
          } catch(e) { return null; }
        },
        set: function(key, value) {
          try { localStorage.setItem('artifact:' + _AID + ':' + key, JSON.stringify(value)); }
          catch(e) { console.warn('[phoChat.storage] set failed:', e); }
        },
        delete: function(key) {
          localStorage.removeItem('artifact:' + _AID + ':' + key);
        },
        list: function(prefix) {
          var pfx = 'artifact:' + _AID + ':' + (prefix || '');
          var keys = [];
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.startsWith(pfx)) keys.push(k.slice(('artifact:' + _AID + ':').length));
          }
          return keys;
        }
      },
      askAI: function(prompt, options) {
        options = options || {};
        return fetch('/api/artifact-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt,
            systemPrompt: options.systemPrompt || '',
            model: options.model || 'gemini-2.5-flash'
          })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d && d.text) return d.text;
          // Billing/tier errors use createErrorResponse shape:
          //   { body: { error: { message } }, errorType }
          // Auth/validation errors still use raw NextResponse: { error: '...' }
          var nestedMsg = d && d.body && d.body.error && d.body.error.message;
          var rawMsg = d && typeof d.error === 'string' ? d.error : null;
          return nestedMsg || rawMsg || 'No response';
        });
      }
    };

    // ── Error forwarding to parent ─────────────────────────────────────
    window.onerror = function(msg, _url, line, col) {
      window.parent.postMessage({
        type: 'artifact-error',
        message: String(msg),
        line: line,
        column: col
      }, '*');
    };
    window.addEventListener('unhandledrejection', function(e) {
      window.parent.postMessage({
        type: 'artifact-error',
        message: 'Unhandled Promise: ' + String(e.reason)
      }, '*');
    });

    // ── Decode, compile, and run ───────────────────────────────────────
    try {
      var encoded = document.getElementById('_artifact_code').textContent;
      if (!encoded || !encoded.trim()) {
        document.getElementById('root').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:14px;">No code to preview</div>';
        window.parent.postMessage({ type: 'artifact-ready' }, '*');
        return;
      }

      // Decode base64 with full Unicode support (matches TextEncoder in parent)
      var rawBytes = atob(encoded);
      var uint8 = new Uint8Array(rawBytes.length);
      for (var i = 0; i < rawBytes.length; i++) { uint8[i] = rawBytes.charCodeAt(i); }
      var code = new TextDecoder().decode(uint8);

      if (!code.trim()) {
        document.getElementById('root').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:14px;">No code to preview</div>';
        window.parent.postMessage({ type: 'artifact-ready' }, '*');
        return;
      }

      // Compile with Babel — wrap to provide better error context
      var compiled;
      try {
        compiled = Babel.transform(code, {
          presets: ['env', 'react', 'typescript'],
          filename: 'App.tsx'
        }).code;
      } catch (babelErr) {
        var errMsg = (babelErr && babelErr.message) || String(babelErr);
        if (babelErr && babelErr.loc && babelErr.loc.line) {
          var lines = code.split('\\n');
          var lineNum = babelErr.loc.line;
          var failingLine = lines[lineNum - 1];
          if (failingLine) {
            errMsg += '\\n\\nLine ' + lineNum + ': ' + failingLine.trim();
          }
        }
        throw new Error(errMsg);
      }

      // Execute in a function scope with module/exports/require available
      var fn = new Function('module', 'exports', 'require', 'React', 'ReactDOM', compiled);
      fn(module, module.exports, require, React, ReactDOM);

      var Component = module.exports.__esModule
        ? (module.exports.default || module.exports)
        : (module.exports.default || module.exports);

      if (typeof Component === 'function' || (Component && typeof Component === 'object' && Component.$$typeof)) {
        var root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(Component));
        window.parent.postMessage({ type: 'artifact-ready' }, '*');
      } else {
        window.parent.postMessage({
          type: 'artifact-error',
          message: 'No default export found. The artifact must use "export default".'
        }, '*');
      }
    } catch (e) {
      window.parent.postMessage({
        type: 'artifact-error',
        message: (e && e.message) || String(e)
      }, '*');
    }
  })();
  </script>
</body>
</html>`;
}
