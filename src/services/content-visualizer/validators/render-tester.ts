/**
 * Stage 4: Render Test
 * Headless render test for React Artifact code.
 * Verifies: renders without errors, produces visible output, handlers attached.
 *
 * Note: Full JSDOM/Puppeteer render is expensive. This stage performs
 * static analysis heuristics as a lightweight alternative that can
 * be upgraded to actual headless rendering when infrastructure is ready.
 */

export interface RenderTestResult {
  errors: string[];
  valid: boolean;
  warnings: string[];
}

/**
 * Check that the component returns JSX (has a return statement with JSX).
 */
function checkReturnsJsx(code: string): string[] {
  const errors: string[] = [];

  // Must have a return statement with JSX
  const hasReturnJsx = /return\s*\([\S\s]*?</.test(code) || /return\s+</.test(code);

  if (!hasReturnJsx) {
    errors.push('Component does not appear to return JSX. Must return React elements.');
  }

  return errors;
}

/**
 * Check for common runtime error patterns.
 */
function checkRuntimePatterns(code: string): string[] {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Undefined variable access patterns
  if (/\.map\(/.test(code) && !/\?\.\s*map\(/.test(code) && !/\|\|\s*\[]/.test(code)) {
    // .map() without optional chaining or default — could throw on undefined
    // Only warn, not error, since the variable may be initialized
    warnings.push('Potential null .map() call without optional chaining or default array.');
  }

  // Division by zero patterns
  if (/\/\s*(?:0|totalScenes|total|count|length)\b/.test(code)) {
    const hasSafeGuard = /Math\.max\s*\(\s*1/.test(code) || /\|\|\s*1/.test(code);
    if (!hasSafeGuard) {
      warnings.push('Potential division by zero. Consider guard: Math.max(1, divisor).');
    }
  }

  // Infinite useEffect without deps
  if (/useEffect\(\s*\(\)\s*=>\s*{[\S\s]*?}\s*\)(?!\s*;?\s*\/\/)/.test(code)) {
    // useEffect without dependency array — check if it's the no-deps version
    const effectWithoutDeps = /useEffect\(\s*(?:function|\(\))\s*(?:=>)?\s*{[\S\s]*?}\s*\)\s*;/g;
    const effectWithDeps = /useEffect\(\s*(?:function|\(\))\s*(?:=>)?\s*{[\S\s]*?}\s*,\s*\[/g;
    const withoutCount = (code.match(effectWithoutDeps) || []).length;
    const withCount = (code.match(effectWithDeps) || []).length;

    if (withoutCount > withCount) {
      errors.push('useEffect without dependency array detected. This causes infinite re-renders.');
    }
  }

  return [...errors, ...warnings];
}

/**
 * Check that visible output elements exist.
 */
function checkVisibleOutput(code: string): string[] {
  const errors: string[] = [];

  // Must have some visual content
  const hasVisualElements =
    /<svg[\s>]/.test(code) ||
    /<canvas[\s>]/.test(code) ||
    /<div[\s>]/.test(code) ||
    /<section[\s>]/.test(code) ||
    /<main[\s>]/.test(code);

  if (!hasVisualElements) {
    errors.push('No visible DOM elements (div, svg, canvas) found in rendered output.');
  }

  // Check for at least some content (text, shapes, etc.)
  const hasContent =
    /className=/.test(code) ||
    /style=/.test(code) ||
    /<text[\s>]/.test(code) ||
    /<path[\s>]/.test(code) ||
    /<circle[\s>]/.test(code) ||
    /<rect[\s>]/.test(code);

  if (!hasContent) {
    errors.push('No styled or visual content elements found. Visualization may render blank.');
  }

  return errors;
}

/**
 * Check that event handlers are properly attached.
 */
function checkEventHandlers(code: string): string[] {
  const warnings: string[] = [];

  // Check for undefined handler references
  const handlerRefs =
    code.match(/on(?:Click|MouseEnter|MouseLeave|TouchStart|Change)\s*=\s*{(\w+)}/g) || [];

  for (const ref of handlerRefs) {
    const fnName = ref.match(/{(\w+)}/)![1];
    // Check if function is defined
    const isDefined =
      new RegExp(`(?:const|let|var|function)\\s+${fnName}\\b`).test(code) ||
      new RegExp(`${fnName}\\s*=\\s*(?:use\\w+|\\()`).test(code);

    if (!isDefined) {
      warnings.push(`Handler "${fnName}" referenced but may not be defined.`);
    }
  }

  return warnings;
}

/**
 * Run render test validation on generated React Artifact code.
 * Uses static analysis heuristics as a lightweight headless render proxy.
 *
 * @param code - JSX source code string
 * @returns RenderTestResult with errors and warnings
 */
export function validateRender(code: string): RenderTestResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  errors.push(...checkReturnsJsx(code), ...checkVisibleOutput(code));

  const runtimeIssues = checkRuntimePatterns(code);
  // First pass: separate real errors from warnings
  for (const issue of runtimeIssues) {
    if (issue.includes('infinite re-renders') || issue.includes('does not appear')) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  warnings.push(...checkEventHandlers(code));

  return {
    errors,
    valid: errors.length === 0,
    warnings,
  };
}
