import { describe, expect, it } from 'vitest';

import { escapeJsxTextContent } from './escapeJsx';

describe('escapeJsxTextContent', () => {
  // ── Bare > in text content ────────────────────────────────────────────
  describe('escape > in JSX text content', () => {
    it('should escape bare > between tags', () => {
      const input = '<p>smart > brute force</p>';
      const result = escapeJsxTextContent(input);
      expect(result).toBe('<p>smart &gt; brute force</p>');
    });

    it('should escape multiple > in same text node', () => {
      const input = '<p>a > b > c</p>';
      const result = escapeJsxTextContent(input);
      expect(result).toBe('<p>a &gt; b &gt; c</p>');
    });

    it('should escape > in nested JSX text', () => {
      const input = '<div><span>x > y</span></div>';
      const result = escapeJsxTextContent(input);
      expect(result).toBe('<div><span>x &gt; y</span></div>');
    });

    it('should escape < in text content', () => {
      // The < before 3 would be caught as &lt;
      const result = escapeJsxTextContent('return <p>a &lt; 3</p>');
      // Already escaped input should pass through
      expect(result).toContain('&lt;');
    });
  });

  // ── Should NOT escape valid JSX / JS ──────────────────────────────────
  describe('preserve valid code', () => {
    it('should not modify tag closing >', () => {
      const input = '<div className="foo">hello</div>';
      const result = escapeJsxTextContent(input);
      expect(result).toBe('<div className="foo">hello</div>');
    });

    it('should not escape > inside JSX expressions', () => {
      const input = '<div>{a > b ? "yes" : "no"}</div>';
      const result = escapeJsxTextContent(input);
      expect(result).toBe('<div>{a > b ? "yes" : "no"}</div>');
    });

    it('should not escape > in JavaScript code', () => {
      const input = 'const x = a > b;\nconst y = c >= d;';
      const result = escapeJsxTextContent(input);
      expect(result).toBe(input);
    });

    it('should not escape > inside string literals', () => {
      const input = 'const s = "a > b";';
      const result = escapeJsxTextContent(input);
      expect(result).toBe(input);
    });

    it('should not escape > inside template literals', () => {
      const input = 'const s = `a > b`;';
      const result = escapeJsxTextContent(input);
      expect(result).toBe(input);
    });

    it('should not escape arrow functions', () => {
      const input = 'const fn = () => <div>hello</div>;';
      const result = escapeJsxTextContent(input);
      expect(result).toBe(input);
    });

    it('should preserve self-closing tags', () => {
      const input = '<br />';
      const result = escapeJsxTextContent(input);
      expect(result).toBe(input);
    });

    it('should not escape > in generic type parameters', () => {
      const input = 'const arr: Array<number> = [];';
      const result = escapeJsxTextContent(input);
      expect(result).toBe(input);
    });

    it('should not escape > in useState generic', () => {
      const input = 'const [x, setX] = useState<string>("");';
      const result = escapeJsxTextContent(input);
      expect(result).toBe(input);
    });
  });

  // ── Complex / nested JSX ──────────────────────────────────────────────
  describe('nested components and complex JSX', () => {
    it('should handle nested components with text content', () => {
      const input = `return (
  <div>
    <h1>Title</h1>
    <p>smart architecture > brute force</p>
    <span>normal text</span>
  </div>
);`;
      const result = escapeJsxTextContent(input);
      expect(result).toContain('<p>smart architecture &gt; brute force</p>');
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('<span>normal text</span>');
    });

    it('should handle mixed code and JSX', () => {
      const input = `const App = () => {
  const x = 5 > 3;
  return <div>result > expected</div>;
};`;
      const result = escapeJsxTextContent(input);
      expect(result).toContain('5 > 3'); // JS code untouched
      expect(result).toContain('result &gt; expected'); // JSX text escaped
    });

    it('should handle JSX inside expressions (map)', () => {
      const input = '<ul>{items.map(i => <li key={i}>{i > 0 ? "pos" : "neg"}</li>)}</ul>';
      const result = escapeJsxTextContent(input);
      // > inside expression should NOT be escaped
      expect(result).toContain('i > 0');
      // No text content with > in this case
      expect(result).toBe(input);
    });

    it('should handle fragments', () => {
      const input = 'return <><p>a > b</p></>';
      const result = escapeJsxTextContent(input);
      expect(result).toContain('a &gt; b');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle empty input', () => {
      expect(escapeJsxTextContent('')).toBe('');
    });

    it('should handle code with no JSX', () => {
      const input = 'const x = 1;\nconst y = 2;';
      expect(escapeJsxTextContent(input)).toBe(input);
    });

    it('should handle comments', () => {
      const input = '// a > b\nreturn <p>x > y</p>;';
      const result = escapeJsxTextContent(input);
      expect(result).toContain('// a > b'); // comment untouched
      expect(result).toContain('x &gt; y'); // JSX text escaped
    });

    it('should handle block comments', () => {
      const input = '/* a > b */\nreturn <p>text</p>;';
      const result = escapeJsxTextContent(input);
      expect(result).toContain('/* a > b */');
    });

    it('should handle string attributes in tags', () => {
      const input = '<div data-info="a > b">text > here</div>';
      const result = escapeJsxTextContent(input);
      // Attribute string should be untouched
      expect(result).toContain('data-info="a > b"');
      // Text content should be escaped
      expect(result).toContain('text &gt; here');
    });

    it('should handle already-escaped content', () => {
      const input = '<p>a &gt; b</p>';
      const result = escapeJsxTextContent(input);
      // Should not double-escape (& is not a special char in our escaping)
      expect(result).toBe(input);
    });
  });
});
