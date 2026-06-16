'use client';

/**
 * Impact Factor Lookup via OpenAlex (free, no key needed)
 * - Batch-fetches journal h-index, cited_by_count, OA status for included papers
 * - Manual search for any journal name
 * - Ranked journal table + per-paper quartile estimation
 */
import { Tag } from '@lobehub/ui';
import { Input } from 'antd';
import { createStyles } from 'antd-style';
import { BarChart2, Loader2, Search, Star, TrendingUp } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useResearchStore } from '@/store/research';

interface JournalMetrics {
  citedByCount: number;
  country?: string;
  error?: string;
  hIndex?: number;
  id: string;
  isOA?: boolean;
  name: string;
  publisher?: string;
  worksCount: number;
}

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  container: css`
    width: 100%;
  `,
  metricChip: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 10px;

    font-size: 11px;

    background: ${token.colorFillSecondary};
  `,
  paperRow: css`
    display: grid;
    grid-template-columns: 1fr 160px 60px 90px 80px;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${token.colorBorder};

    font-size: 11px;

    &:last-child {
      border-block-end: none;
    }

    &:hover {
      background: ${token.colorFillQuaternary};
    }
  `,
  tableHeader: css`
    display: grid;
    grid-template-columns: 1fr 160px 60px 90px 80px;
    gap: 8px;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 2px solid ${token.colorBorderSecondary};

    font-size: 10px;
    font-weight: 700;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;

    background: ${token.colorFillQuaternary};
  `,
  tableWrap: css`
    overflow-y: auto;
    max-height: 380px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
  `,
}));

const journalCache: Record<string, JournalMetrics> = {};

const fetchJournalMetrics = async (name: string): Promise<JournalMetrics> => {
  const key = name.toLowerCase().trim();
  if (journalCache[key]) return journalCache[key];
  try {
    const url = `https://api.openalex.org/sources?filter=display_name.search:${encodeURIComponent(key)}&per-page=1&select=id,display_name,cited_by_count,works_count,country_code,is_oa,publisher,summary_stats`;
    const res = await fetch(url, { headers: { 'User-Agent': 'PhoChat/1.0' } });
    if (!res.ok) throw new Error(`OpenAlex: ${res.status}`);
    const data = await res.json();
    const r = data.results?.[0];
    if (!r) throw new Error('Not found');
    const m: JournalMetrics = {
      citedByCount: r.cited_by_count ?? 0,
      country: r.country_code,
      hIndex: r.summary_stats?.h_index,
      id: key,
      isOA: r.is_oa ?? false,
      name: r.display_name ?? name,
      publisher: r.publisher,
      worksCount: r.works_count ?? 0,
    };
    journalCache[key] = m;
    return m;
  } catch (e) {
    return { citedByCount: 0, error: (e as Error).message, id: key, name, worksCount: 0 };
  }
};

const estimateQ = (h?: number) => {
  if (h === undefined) return '—';
  if (h >= 200) return 'Q1 ★★★★';
  if (h >= 100) return 'Q1 ★★★';
  if (h >= 50) return 'Q2 ★★';
  if (h >= 20) return 'Q3 ★';
  return 'Q4';
};

const qColor = (q: string) =>
  q.startsWith('Q1')
    ? '#52c41a'
    : q.startsWith('Q2')
      ? '#1890ff'
      : q.startsWith('Q3')
        ? '#faad14'
        : '#ff4d4f';

const ImpactFactor = memo(() => {
  const { styles } = useStyles();
  const papers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const includedPapers = useMemo(
    () => papers.filter((p) => screeningDecisions[p.id]?.decision === 'included'),
    [papers, screeningDecisions],
  );
  const uniqueJournals = useMemo(() => {
    const seen = new Set<string>();
    return includedPapers
      .filter(
        (p) => p.journal && !seen.has(p.journal.toLowerCase()) && seen.add(p.journal.toLowerCase()),
      )
      .map((p) => p.journal!);
  }, [includedPapers]);

  const [metrics, setMetrics] = useState<Record<string, JournalMetrics>>({});
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [manualResult, setManualResult] = useState<JournalMetrics | null>(null);
  const [searching, setSearching] = useState(false);

  const fetchAll = useCallback(async () => {
    if (uniqueJournals.length === 0) return;
    setLoading(true);
    const results: Record<string, JournalMetrics> = {};
    await Promise.allSettled(
      uniqueJournals.slice(0, 15).map(async (j) => {
        const m = await fetchJournalMetrics(j);
        results[j.toLowerCase()] = m;
      }),
    );
    setMetrics(results);
    setLoading(false);
  }, [uniqueJournals]);

  const searchManual = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setManualResult(await fetchJournalMetrics(query.trim()));
    setSearching(false);
  }, [query]);

  const ranked = useMemo(
    () =>
      Object.values(metrics)
        .filter((m) => !m.error)
        .sort((a, b) => (b.hIndex ?? 0) - (a.hIndex ?? 0)),
    [metrics],
  );

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📊 Journal Impact Factor Lookup</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            h-index · citations · quartile estimate via OpenAlex (free)
          </span>
        </Flexbox>
        <button
          disabled={loading || uniqueJournals.length === 0}
          onClick={fetchAll}
          style={{
            alignItems: 'center',
            background: 'rgba(24,144,255,0.1)',
            border: '1px solid #1890ff',
            borderRadius: 6,
            color: '#1890ff',
            cursor: 'pointer',
            display: 'flex',
            fontSize: 12,
            gap: 6,
            padding: '4px 12px',
          }}
          type="button"
        >
          {loading ? <Loader2 className="animate-spin" size={13} /> : <TrendingUp size={13} />}
          {loading ? 'Fetching…' : `Fetch ${uniqueJournals.length} Journals`}
        </button>
      </Flexbox>

      {/* Manual search */}
      <div className={styles.card}>
        <Flexbox gap={6}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>🔍 Search any journal</span>
          <Flexbox gap={8} horizontal>
            <Input
              onChange={(e) => setQuery(e.target.value)}
              onPressEnter={searchManual}
              placeholder="e.g. The Lancet, NEJM, JAMA, Nature Medicine…"
              size="small"
              style={{ flex: 1 }}
              value={query}
            />
            <button
              disabled={searching}
              onClick={searchManual}
              style={{
                alignItems: 'center',
                background: '#1890ff',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                fontSize: 12,
                gap: 4,
                padding: '4px 12px',
              }}
              type="button"
            >
              {searching ? <Loader2 className="animate-spin" size={12} /> : <Search size={12} />}{' '}
              Search
            </button>
          </Flexbox>
          {manualResult && !manualResult.error && (
            <Flexbox gap={6}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{manualResult.name}</span>
              <Flexbox gap={8} horizontal wrap={'wrap'}>
                {manualResult.hIndex !== undefined && (
                  <span className={styles.metricChip}>
                    <Star size={10} /> h-index: {manualResult.hIndex}
                  </span>
                )}
                <span className={styles.metricChip}>
                  <BarChart2 size={10} /> {manualResult.citedByCount.toLocaleString()} cit.
                </span>
                <Tag color={qColor(estimateQ(manualResult.hIndex))}>
                  {estimateQ(manualResult.hIndex)}
                </Tag>
                {manualResult.isOA && <Tag color="green">Open Access</Tag>}
                {manualResult.publisher && (
                  <span style={{ fontSize: 11, opacity: 0.6 }}>{manualResult.publisher}</span>
                )}
              </Flexbox>
            </Flexbox>
          )}
          {manualResult?.error && (
            <span style={{ color: '#ff4d4f', fontSize: 12 }}>❌ {manualResult.error}</span>
          )}
        </Flexbox>
      </div>

      {/* Ranked table */}
      {ranked.length > 0 && (
        <Flexbox gap={6}>
          <Flexbox gap={6} horizontal wrap={'wrap'}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              📈 Journals in review — ranked by h-index
            </span>
            <Tag>{ranked.length} journals fetched</Tag>
          </Flexbox>
          <div className={styles.tableWrap}>
            <div className={styles.tableHeader}>
              <span>Journal</span>
              <span>Publisher</span>
              <span>h-Index</span>
              <span>Citations</span>
              <span>Quartile</span>
            </div>
            {ranked.map((m, i) => {
              const q = estimateQ(m.hIndex);
              return (
                <div className={styles.paperRow} key={m.id}>
                  <Flexbox gap={2}>
                    <span style={{ fontWeight: 600 }}>
                      {i + 1}. {m.name}
                    </span>
                    <Flexbox gap={4} horizontal>
                      {m.isOA && (
                        <Tag color="green" style={{ fontSize: 9 }}>
                          OA
                        </Tag>
                      )}
                      {m.country && <span style={{ fontSize: 10, opacity: 0.5 }}>{m.country}</span>}
                    </Flexbox>
                  </Flexbox>
                  <span style={{ fontSize: 11, opacity: 0.6 }}>{m.publisher ?? '—'}</span>
                  <span style={{ fontWeight: 700 }}>{m.hIndex ?? '—'}</span>
                  <span>{m.citedByCount.toLocaleString()}</span>
                  <Tag color={qColor(q)} style={{ fontSize: 10 }}>
                    {q.split(' ')[0]}
                  </Tag>
                </div>
              );
            })}
          </div>
        </Flexbox>
      )}

      {includedPapers.length === 0 && (
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
          Include papers in Screening phase to look up journal metrics.
        </div>
      )}
    </Flexbox>
  );
});

ImpactFactor.displayName = 'ImpactFactor';
export default ImpactFactor;
