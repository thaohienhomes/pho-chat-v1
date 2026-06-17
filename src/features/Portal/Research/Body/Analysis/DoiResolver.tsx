'use client';

/**
 * DOI Resolver — Fetch paper metadata from CrossRef API (free, no auth required)
 *
 * CrossRef API: https://api.crossref.org/works/{doi}
 * Also supports PubMed PMID lookup via: https://pubmed.ncbi.nlm.nih.gov/api/...
 *
 * Features:
 * - Paste DOI or PMID → resolve metadata (title, authors, year, journal, abstract)
 * - Add to included papers list directly
 * - Bulk DOI input (one per line)
 * - Copy as formatted citation (Vancouver, APA, BibTeX)
 */
import { Button, Tag } from '@lobehub/ui';
import { Input, Select } from 'antd';
import { createStyles } from 'antd-style';
import { CheckCircle, Copy, Loader2, Plus, Search, XCircle } from 'lucide-react';
import React, { memo, useCallback, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useResearchStore } from '@/store/research';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ResolvedPaper {
  abstract?: string;
  authors: string;
  doi?: string;
  error?: string;
  id: string;
  journal: string;
  pmid?: string;
  title: string;
  year: number;
}

type CitationStyle = 'apa' | 'bibtex' | 'vancouver';

// ── Styles ────────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  abstractBox: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    font-size: 11px;
    color: ${token.colorTextSecondary};
  `,
  card: css`
    padding: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};

    transition: background 0.2s;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  container: css`
    width: 100%;
  `,
  inputRow: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  journal: css`
    font-size: 11px;
    font-style: italic;
    color: ${token.colorTextSecondary};
  `,
  statsBar: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    font-size: 12px;

    background: ${token.colorFillQuaternary};
  `,
  title: css`
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    color: ${token.colorText};
  `,
}));

// ── CrossRef API helpers ──────────────────────────────────────────────────────
const cleanDOI = (raw: string): string =>
  raw
    .trim()
    .replaceAll(/^https?:\/\/(dx\.)?doi\.org\//gi, '')
    .replaceAll(/^doi:\s*/gi, '');

const fetchDOI = async (doi: string): Promise<ResolvedPaper> => {
  const clean = cleanDOI(doi);
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(clean)}`, {
    headers: { 'User-Agent': 'PhoChat/1.0 (mailto:support@pho.chat)' },
  });
  if (!res.ok) throw new Error(`CrossRef: ${res.status} for DOI ${clean}`);
  const json = await res.json();
  const work = json.message;

  const authors =
    (work.author ?? [])
      .map((a: { family?: string; given?: string }) => `${a.family ?? ''}, ${a.given ?? ''}`)
      .slice(0, 6)
      .join('; ') || 'Unknown';

  const year =
    work.published?.['date-parts']?.[0]?.[0] ??
    work['published-print']?.['date-parts']?.[0]?.[0] ??
    0;

  const journal = work['container-title']?.[0] ?? work.publisher ?? 'Unknown Journal';
  const title = (work.title?.[0] ?? 'Untitled').replaceAll(/<[^>]+>/g, ''); // strip HTML tags
  const abstract = (work.abstract ?? '').replaceAll(/<[^>]+>/g, '').trim();

  return {
    abstract: abstract || undefined,
    authors,
    doi: clean,
    id: `doi-${clean.replaceAll('/', '-')}`,
    journal,
    title,
    year,
  };
};

// ── Citation formatters ───────────────────────────────────────────────────────
const toCitation = (p: ResolvedPaper, style: CitationStyle): string => {
  const firstAuthor = p.authors.split(';')[0]?.trim() ?? 'Unknown';
  const authorKey = firstAuthor.split(',')[0]?.trim().toLowerCase() ?? 'unknown';

  switch (style) {
    case 'vancouver': {
      return `${p.authors}. ${p.title}. *${p.journal}*. ${p.year}.${p.doi ? ` doi:${p.doi}` : ''}`;
    }
    case 'apa': {
      return `${p.authors} (${p.year}). ${p.title}. *${p.journal}*.${p.doi ? ` https://doi.org/${p.doi}` : ''}`;
    }
    case 'bibtex': {
      const key = `${authorKey}${p.year}`;
      return `@article{${key},\n  author  = {${p.authors}},\n  title   = {${p.title}},\n  journal = {${p.journal}},\n  year    = {${p.year}},${p.doi ? `\n  doi     = {${p.doi}},` : ''}\n}`;
    }
    // No default
  }
};

// ── Component ─────────────────────────────────────────────────────────────────
const DoiResolver = memo(() => {
  const { styles } = useStyles();
  const addPaper = useResearchStore((s) => s.addPaper);

  const [input, setInput] = useState('');
  const [results, setResults] = useState<ResolvedPaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('vancouver');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    const dois = input
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (dois.length === 0) return;

    setLoading(true);
    const resolved: ResolvedPaper[] = [];

    for (const doi of dois) {
      try {
        const paper = await fetchDOI(doi);
        resolved.push(paper);
      } catch (err) {
        resolved.push({
          authors: '',
          error: (err as Error).message,
          id: `err-${doi}`,
          journal: '',
          title: `Failed: ${doi}`,
          year: 0,
        });
      }
    }

    setResults((prev) => {
      const existingIds = new Set(prev.map((r) => r.id));
      const newOnes = resolved.filter((r) => !existingIds.has(r.id));
      return [...newOnes, ...prev];
    });
    setLoading(false);
    setInput('');
  }, [input]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        resolve();
      }
    },
    [resolve],
  );

  const handleAdd = useCallback(
    (paper: ResolvedPaper) => {
      if (added.has(paper.id)) return;
      addPaper({
        abstract: paper.abstract,
        authors: paper.authors,
        citations: 0,
        doi: paper.doi,
        id: paper.id,
        journal: paper.journal,
        source: 'PubMed',
        title: paper.title,
        url: paper.doi ? `https://doi.org/${paper.doi}` : '',
        year: paper.year,
      });
      setAdded((prev) => new Set([...prev, paper.id]));
    },
    [added, addPaper],
  );

  const handleCopy = useCallback(
    (paper: ResolvedPaper) => {
      navigator.clipboard.writeText(toCitation(paper, citationStyle));
      setCopiedId(paper.id);
      setTimeout(() => setCopiedId(null), 2000);
    },
    [citationStyle],
  );

  const clearResults = useCallback(() => {
    setResults([]);
    setAdded(new Set());
  }, []);

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox gap={2}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>🔗 DOI / PMID Resolver</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          Resolve DOIs via CrossRef API (free, no API key) — add papers directly to your review
        </span>
      </Flexbox>

      {/* Input */}
      <Flexbox gap={8}>
        <Input.TextArea
          autoSize={{ maxRows: 8, minRows: 2 }}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Paste one or more DOIs (one per line):\n\n10.1056/NEJMoa2034577\n10.1016/S0140-6736(20)30183-5\nhttps://doi.org/10.1038/s41591-020-0897-1`}
          value={input}
        />
        <Flexbox gap={8} horizontal>
          <Button
            icon={loading ? <Loader2 className="animate-spin" size={13} /> : <Search size={13} />}
            loading={loading}
            onClick={resolve}
            type={'primary'}
          >
            {loading ? 'Resolving...' : 'Resolve DOIs'}
          </Button>
          <span style={{ alignSelf: 'center', fontSize: 11, opacity: 0.5 }}>
            Shift+Enter for multiple. Press Enter to resolve.
          </span>
        </Flexbox>
      </Flexbox>

      {/* Results controls */}
      {results.length > 0 && (
        <div className={styles.statsBar}>
          <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
            <Flexbox gap={6} horizontal>
              <Tag>{results.length} resolved</Tag>
              <Tag color="green">{added.size} added to review</Tag>
            </Flexbox>
            <Flexbox align={'center'} gap={6} horizontal>
              <span style={{ fontSize: 11, opacity: 0.6 }}>Citation format:</span>
              <Select
                onChange={(v) => setCitationStyle(v)}
                options={[
                  { label: 'Vancouver', value: 'vancouver' },
                  { label: 'APA', value: 'apa' },
                  { label: 'BibTeX', value: 'bibtex' },
                ]}
                size="small"
                value={citationStyle}
              />
              <button
                onClick={clearResults}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,0,0,0.3)',
                  borderRadius: 4,
                  color: '#ff4d4f',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: '2px 8px',
                }}
                type="button"
              >
                Clear
              </button>
            </Flexbox>
          </Flexbox>
        </div>
      )}

      {/* Paper cards */}
      {results.map((paper) => (
        <div className={styles.card} key={paper.id}>
          {paper.error ? (
            <Flexbox align={'center'} gap={8} horizontal>
              <XCircle size={16} style={{ color: '#ff4d4f', flexShrink: 0 }} />
              <div>
                <div style={{ color: '#ff4d4f', fontSize: 12, fontWeight: 600 }}>{paper.title}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>{paper.error}</div>
              </div>
            </Flexbox>
          ) : (
            <Flexbox gap={10}>
              {/* Title + meta */}
              <Flexbox gap={4}>
                <div className={styles.title}>{paper.title}</div>
                <div className={styles.journal}>
                  {paper.journal} · {paper.year}
                  {paper.doi && (
                    <a
                      href={`https://doi.org/${paper.doi}`}
                      rel="noreferrer"
                      style={{ fontSize: 10, marginLeft: 8, opacity: 0.6 }}
                      target="_blank"
                    >
                      doi:{paper.doi}
                    </a>
                  )}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{paper.authors}</div>
                {paper.abstract && <div className={styles.abstractBox}>{paper.abstract}</div>}
              </Flexbox>

              {/* Actions */}
              <Flexbox gap={6} horizontal>
                <Button
                  disabled={added.has(paper.id)}
                  icon={added.has(paper.id) ? <CheckCircle size={12} /> : <Plus size={12} />}
                  onClick={() => handleAdd(paper)}
                  size={'small'}
                  style={added.has(paper.id) ? { borderColor: '#52c41a', color: '#52c41a' } : {}}
                  type={'default'}
                >
                  {added.has(paper.id) ? 'Added to Review' : 'Add to Review'}
                </Button>
                <Button
                  icon={copiedId === paper.id ? <CheckCircle size={12} /> : <Copy size={12} />}
                  onClick={() => handleCopy(paper)}
                  size={'small'}
                >
                  {copiedId === paper.id ? 'Copied!' : `Copy ${citationStyle.toUpperCase()}`}
                </Button>
              </Flexbox>
            </Flexbox>
          )}
        </div>
      ))}

      {results.length === 0 && !loading && (
        <div
          style={{
            border: '1px dashed',
            borderRadius: 8,
            fontSize: 12,
            opacity: 0.4,
            padding: 32,
            textAlign: 'center',
          }}
        >
          Paste DOIs above to resolve paper metadata.
          <br />
          Works with any DOI including PubMed, Lancet, NEJM, Nature.
          <br />
          <strong>Example:</strong> 10.1056/NEJMoa2034577
        </div>
      )}
    </Flexbox>
  );
});

DoiResolver.displayName = 'DoiResolver';
export default DoiResolver;
