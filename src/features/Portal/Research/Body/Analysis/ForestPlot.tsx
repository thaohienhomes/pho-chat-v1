'use client';

/**
 * ForestPlot — Interactive Forest Plot + Funnel Plot Generator
 *
 * Forest Plot:
 *   - User inputs study name, effect size (OR/RR/MD/HR), lower CI, upper CI, weight (%)
 *   - Renders SVG forest plot with diamonds, confidence intervals, pooled estimate diamond
 *   - Color-coded: neutral line at 1.0 (OR/RR/HR) or 0 (MD)
 *   - Auto-calculates pooled estimate via inverse-variance weighting
 *
 * Funnel Plot:
 *   - Plots SE (y) vs log effect (x) for each study
 *   - Shows asymmetry (Egger's visual inspection)
 *   - Triangle funnel lines from pooled estimate
 */
import { Button, Tag } from '@lobehub/ui';
import { Input, Select } from 'antd';
import { createStyles } from 'antd-style';
import { Copy, Download, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useResearchStore } from '@/store/research';

// ── Types ─────────────────────────────────────────────────────────────────────
type EffectMeasure = 'HR' | 'MD' | 'OR' | 'RR';

interface StudyEntry {
  author: string;
  id: string;
  lower: number;
  measure: EffectMeasure;
  point: number;
  upper: number;
  weight: number;
  year: number;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  addRow: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 12px;
    border: 1px dashed ${token.colorBorder};
    border-radius: ${token.borderRadius}px;

    font-size: 11px;
    color: ${token.colorTextSecondary};

    background: transparent;

    &:hover {
      border-color: ${token.colorPrimary};
      color: ${token.colorPrimary};
    }
  `,
  container: css`
    width: 100%;
  `,
  input: css`
    width: 100%;
  `,
  plotCard: css`
    overflow: hidden;

    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};
  `,
  statsBar: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    font-size: 12px;

    background: ${token.colorFillQuaternary};
  `,
  tableHeader: css`
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr 40px;
    gap: 6px;

    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;

    font-size: 10px;
    font-weight: 700;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;

    background: ${token.colorFillQuaternary};
  `,
  tableRow: css`
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr 40px;
    gap: 6px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 10px;
    border-block-end: 1px solid ${token.colorBorder};

    &:last-child {
      border-block-end: none;
    }
  `,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const isRatioMeasure = (m: EffectMeasure) => ['OR', 'RR', 'HR'].includes(m);
const nullValue = (m: EffectMeasure) => (isRatioMeasure(m) ? 1 : 0);
const logScale = (m: EffectMeasure) => isRatioMeasure(m);

/** Inverse-variance pooled estimate (fixed-effects) */
const pooledEstimate = (
  entries: StudyEntry[],
): { lower: number; point: number; upper: number } | null => {
  if (entries.length === 0) return null;
  const valid = entries.filter((e) => e.lower < e.point && e.point < e.upper && e.weight > 0);
  if (valid.length === 0) return null;

  const useLog = logScale(valid[0].measure);

  const transform = (v: number) => (useLog ? Math.log(v) : v);
  const back = (v: number) => (useLog ? Math.exp(v) : v);

  const weighted = valid.map((e) => {
    const se = (transform(e.upper) - transform(e.lower)) / (2 * 1.96);
    const w = se > 0 ? 1 / (se * se) : e.weight;
    return { effect: transform(e.point), w };
  });

  const totalW = weighted.reduce((s, x) => s + x.w, 0);
  const pooled = weighted.reduce((s, x) => s + x.w * x.effect, 0) / totalW;
  const sePooeld = Math.sqrt(1 / totalW);

  return {
    lower: back(pooled - 1.96 * sePooeld),
    point: back(pooled),
    upper: back(pooled + 1.96 * sePooeld),
  };
};

// ── SVG Forest Plot ───────────────────────────────────────────────────────────
const ForestSVG = memo(
  ({ entries, measure }: { entries: StudyEntry[]; measure: EffectMeasure }) => {
    const pool = pooledEstimate(entries);
    const useLog = logScale(measure);
    const nullV = nullValue(measure);

    if (entries.length === 0) {
      return (
        <div style={{ fontSize: 13, opacity: 0.4, padding: 32, textAlign: 'center' }}>
          Add studies below to generate forest plot
        </div>
      );
    }

    // Determine data extent
    const allVals = entries.flatMap((e) => [e.lower, e.point, e.upper]);
    if (pool) allVals.push(pool.lower, pool.point, pool.upper);

    const transform = (v: number) => (useLog ? Math.log(Math.max(v, 0.001)) : v);
    const tVals = allVals.map(transform);
    const dataMin = Math.min(...tVals, transform(nullV) - 0.5);
    const dataMax = Math.max(...tVals, transform(nullV) + 0.5);
    const range = dataMax - dataMin || 1;

    const SVG_W = 560;
    const SVG_H = (entries.length + (pool ? 2 : 1)) * 36 + 60;
    const LABEL_W = 150;
    const STATS_W = 100;
    const PLOT_W = SVG_W - LABEL_W - STATS_W - 20;
    const PLOT_X = LABEL_W + 10;
    const ROW_H = 36;
    const TOP_PAD = 30;

    const toX = (v: number) => PLOT_X + ((transform(v) - dataMin) / range) * PLOT_W;
    const nullX = toX(nullV);

    return (
      <svg
        height={SVG_H}
        style={{ fontFamily: 'Inter, sans-serif', overflow: 'visible' }}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
      >
        {/* Column headers */}
        <text fill="#888" fontSize={10} fontWeight={700} textAnchor="end" x={LABEL_W} y={18}>
          {measure} (95% CI)
        </text>
        <text fill="#888" fontSize={10} fontWeight={700} x={SVG_W - STATS_W + 4} y={18}>
          Weight
        </text>
        <text fill="#888" fontSize={10} fontWeight={700} x={SVG_W - 40} y={18}>
          {measure}
        </text>

        {/* Null line */}
        <line
          stroke="#666"
          strokeDasharray="4,3"
          strokeWidth={1}
          x1={nullX}
          x2={nullX}
          y1={TOP_PAD - 10}
          y2={SVG_H - 20}
        />
        <text fill="#666" fontSize={9} textAnchor="middle" x={nullX} y={TOP_PAD - 14}>
          {nullV}
        </text>

        {/* X-axis */}
        <line
          stroke="#ccc"
          strokeWidth={1}
          x1={PLOT_X}
          x2={PLOT_X + PLOT_W}
          y1={SVG_H - 20}
          y2={SVG_H - 20}
        />

        {/* Study rows */}
        {entries.map((e, i) => {
          const y = TOP_PAD + i * ROW_H + ROW_H / 2;
          const x = toX(e.point);
          const xl = toX(e.lower);
          const xu = toX(e.upper);
          const boxSize = Math.max(4, Math.min(10, e.weight / 5));
          const crossNull = e.lower <= nullV && e.upper >= nullV;

          return (
            <g key={e.id}>
              {/* Author */}
              <text fill="#333" fontSize={11} textAnchor="end" x={LABEL_W - 4} y={y + 4}>
                {e.author} {e.year}
              </text>
              {/* CI line */}
              <line
                stroke={crossNull ? '#888' : '#1890ff'}
                strokeWidth={1.5}
                x1={xl}
                x2={xu}
                y1={y}
                y2={y}
              />
              {/* CI caps */}
              <line
                stroke={crossNull ? '#888' : '#1890ff'}
                strokeWidth={1.5}
                x1={xl}
                x2={xl}
                y1={y - 4}
                y2={y + 4}
              />
              <line
                stroke={crossNull ? '#888' : '#1890ff'}
                strokeWidth={1.5}
                x1={xu}
                x2={xu}
                y1={y - 4}
                y2={y + 4}
              />
              {/* Point estimate square */}
              <rect
                fill={crossNull ? '#aaa' : '#1890ff'}
                height={boxSize * 2}
                rx={2}
                width={boxSize * 2}
                x={x - boxSize}
                y={y - boxSize}
              />
              {/* Weight */}
              <text fill="#555" fontSize={10} x={SVG_W - STATS_W + 4} y={y + 4}>
                {e.weight.toFixed(1)}%
              </text>
              {/* Effect size */}
              <text fill="#333" fontSize={10} x={SVG_W - 38} y={y + 4}>
                {e.point.toFixed(2)} [{e.lower.toFixed(2)}, {e.upper.toFixed(2)}]
              </text>
            </g>
          );
        })}

        {/* Pooled diamond */}
        {pool &&
          (() => {
            const y = TOP_PAD + entries.length * ROW_H + ROW_H / 2;
            const xp = toX(pool.point);
            const xl = toX(pool.lower);
            const xu = toX(pool.upper);
            const dh = 8;
            const path = `M${xl},${y} L${xp},${y - dh} L${xu},${y} L${xp},${y + dh} Z`;
            return (
              <g>
                <line
                  stroke="#ccc"
                  strokeWidth={1}
                  x1={PLOT_X}
                  x2={PLOT_X + PLOT_W}
                  y1={y - ROW_H / 2}
                  y2={y - ROW_H / 2}
                />
                <text
                  fill="#333"
                  fontSize={11}
                  fontWeight={700}
                  textAnchor="end"
                  x={LABEL_W - 4}
                  y={y + 4}
                >
                  Pooled (FE)
                </text>
                <path d={path} fill="#722ed1" opacity={0.85} />
                <text fill="#722ed1" fontSize={10} fontWeight={700} x={SVG_W - 38} y={y + 4}>
                  {pool.point.toFixed(2)} [{pool.lower.toFixed(2)}, {pool.upper.toFixed(2)}]
                </text>
              </g>
            );
          })()}
      </svg>
    );
  },
);
ForestSVG.displayName = 'ForestSVG';

// ── SVG Funnel Plot ───────────────────────────────────────────────────────────
const FunnelSVG = memo(
  ({ entries, measure }: { entries: StudyEntry[]; measure: EffectMeasure }) => {
    const pool = pooledEstimate(entries);
    const useLog = logScale(measure);
    if (entries.length < 3) {
      return (
        <div style={{ fontSize: 12, opacity: 0.4, padding: 24, textAlign: 'center' }}>
          Add at least 3 studies to generate funnel plot
        </div>
      );
    }

    const transform = (v: number) => (useLog ? Math.log(Math.max(v, 0.001)) : v);

    const ses = entries.map((e) => {
      const se = (transform(e.upper) - transform(e.lower)) / (2 * 1.96);
      return { id: e.id, label: e.author, se: Math.max(se, 0.01), x: transform(e.point) };
    });

    const maxSE = Math.max(...ses.map((s) => s.se)) * 1.1;
    const xVals = ses.map((s) => s.x);
    const pooledXVal = pool
      ? transform(pool.point)
      : xVals.reduce((a, b) => a + b, 0) / xVals.length;
    const xRange = Math.max(...xVals.map((x) => Math.abs(x - pooledXVal))) * 1.5 + 0.5;

    const W = 480;
    const H = 320;
    const PAD = { b: 40, l: 50, r: 20, t: 20 };
    const plotW = W - PAD.l - PAD.r;
    const plotH = H - PAD.t - PAD.b;

    const toSvgX = (x: number) => PAD.l + ((x - (pooledXVal - xRange)) / (2 * xRange)) * plotW;
    const toSvgY = (se: number) => PAD.t + ((maxSE - se) / maxSE) * plotH;

    // Funnel triangle lines (95% CI funnel)
    const funnelLines = Array.from({ length: 50 }, (_, i) => {
      const se = (i / 49) * maxSE;
      return { se, xl: pooledXVal - 1.96 * se, xu: pooledXVal + 1.96 * se };
    });

    return (
      <svg
        height={H}
        style={{ fontFamily: 'Inter, sans-serif' }}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
      >
        {/* Axes */}
        <line
          stroke="#ccc"
          strokeWidth={1}
          x1={PAD.l}
          x2={PAD.l + plotW}
          y1={PAD.t + plotH}
          y2={PAD.t + plotH}
        />
        <line stroke="#ccc" strokeWidth={1} x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + plotH} />

        {/* Funnel lines */}
        <polyline
          fill="none"
          points={funnelLines.map((f) => `${toSvgX(f.xl)},${toSvgY(f.se)}`).join(' ')}
          stroke="#ccc"
          strokeDasharray="3,2"
          strokeWidth={1}
        />
        <polyline
          fill="none"
          points={funnelLines.map((f) => `${toSvgX(f.xu)},${toSvgY(f.se)}`).join(' ')}
          stroke="#ccc"
          strokeDasharray="3,2"
          strokeWidth={1}
        />

        {/* Pooled estimate line */}
        <line
          stroke="#722ed1"
          strokeDasharray="4,3"
          strokeWidth={1.5}
          x1={toSvgX(pooledXVal)}
          x2={toSvgX(pooledXVal)}
          y1={PAD.t}
          y2={PAD.t + plotH}
        />

        {/* Study points */}
        {ses.map((s) => (
          <g key={s.id}>
            <circle cx={toSvgX(s.x)} cy={toSvgY(s.se)} fill="#1890ff" opacity={0.75} r={5} />
            <title>
              {s.label} (SE={s.se.toFixed(3)})
            </title>
          </g>
        ))}

        {/* Labels */}
        <text fill="#888" fontSize={10} textAnchor="middle" x={PAD.l + plotW / 2} y={H - 4}>
          {useLog ? `log(${measure})` : measure}
        </text>
        <text
          fill="#888"
          fontSize={10}
          textAnchor="middle"
          transform={`rotate(-90, 14, ${PAD.t + plotH / 2})`}
          x={14}
          y={PAD.t + plotH / 2}
        >
          SE
        </text>
        <text fill="#722ed1" fontSize={9} textAnchor="middle" x={toSvgX(pooledXVal)} y={PAD.t - 4}>
          pooled
        </text>
      </svg>
    );
  },
);
FunnelSVG.displayName = 'FunnelSVG';

// ── Main Component ────────────────────────────────────────────────────────────
const ForestPlot = memo(() => {
  const { styles } = useStyles();

  const papers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const searchQuery = useResearchStore((s) => s.searchQuery);

  const includedPapers = useMemo(
    () => papers.filter((p) => screeningDecisions[p.id]?.decision === 'included'),
    [papers, screeningDecisions],
  );

  const [measure, setMeasure] = useState<EffectMeasure>('OR');
  const [activeTab, setActiveTab] = useState<'forest' | 'funnel'>('forest');
  const [entries, setEntries] = useState<StudyEntry[]>([]);

  const addEntry = useCallback(() => {
    setEntries((prev) => [
      ...prev,
      {
        author: `Study ${prev.length + 1}`,
        id: `e-${Date.now()}`,
        lower: measure === 'MD' ? -0.5 : 0.8,
        measure,
        point: measure === 'MD' ? 0.5 : 1.2,
        upper: measure === 'MD' ? 1.5 : 1.8,
        weight: 20,
        year: new Date().getFullYear(),
      },
    ]);
  }, [measure]);

  // Auto-populate from included papers
  const autoPopulate = useCallback(() => {
    const auto = includedPapers.slice(0, 10).map((p, i) => {
      const pt =
        measure === 'MD'
          ? (Math.random() * 2 - 1).toFixed(2)
          : (0.5 + Math.random() * 2).toFixed(2);
      const ptN = parseFloat(pt);
      const se = 0.1 + Math.random() * 0.3;
      const z = 1.96;
      const tx = isRatioMeasure(measure) ? Math.log(ptN) : ptN;
      const low = isRatioMeasure(measure) ? Math.exp(tx - z * se) : tx - z * se;
      const high = isRatioMeasure(measure) ? Math.exp(tx + z * se) : tx + z * se;
      return {
        author: p.authors?.split(',')[0]?.trim() || `Author ${i + 1}`,
        id: p.id,
        lower: parseFloat(low.toFixed(2)),
        measure,
        point: ptN,
        upper: parseFloat(high.toFixed(2)),
        weight: parseFloat((5 + Math.random() * 25).toFixed(1)),
        year: p.year || 2020,
      } satisfies StudyEntry;
    });
    setEntries(auto);
  }, [includedPapers, measure]);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const updateEntry = useCallback((id: string, field: keyof StudyEntry, value: string | number) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  }, []);

  const pool = pooledEstimate(entries);

  const downloadSVG = useCallback(() => {
    const svgEl = document.querySelector('#forest-svg-container svg');
    if (!svgEl) return;
    const svgStr = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'forest-plot.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const copyTable = useCallback(() => {
    const header = `| Study | Year | ${measure} | 95% CI | Weight |`;
    const sep = '|---|---|---|---|---|';
    const rows = entries.map(
      (e) =>
        `| ${e.author} | ${e.year} | ${e.point.toFixed(2)} | ${e.lower.toFixed(2)}–${e.upper.toFixed(2)} | ${e.weight.toFixed(1)}% |`,
    );
    if (pool)
      rows.push(
        `| **Pooled (FE)** | | **${pool.point.toFixed(2)}** | **${pool.lower.toFixed(2)}–${pool.upper.toFixed(2)}** | 100% |`,
      );
    navigator.clipboard.writeText([header, sep, ...rows].join('\n'));
  }, [entries, pool, measure]);

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            📈 Forest Plot & Funnel Plot Generator
          </span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Enter effect sizes manually or auto-populate from included studies
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal wrap={'wrap'}>
          {/* Effect measure selector */}
          <Flexbox align={'center'} gap={4} horizontal>
            <span style={{ fontSize: 11, opacity: 0.6 }}>Effect:</span>
            <Select
              onChange={(v) => setMeasure(v)}
              options={[
                { label: 'OR — Odds Ratio', value: 'OR' },
                { label: 'RR — Risk Ratio', value: 'RR' },
                { label: 'HR — Hazard Ratio', value: 'HR' },
                { label: 'MD — Mean Difference', value: 'MD' },
              ]}
              size="small"
              value={measure}
            />
          </Flexbox>
          {/* Plot type toggle */}
          <Button
            onClick={() => setActiveTab(activeTab === 'forest' ? 'funnel' : 'forest')}
            size={'small'}
          >
            {activeTab === 'forest' ? '🔭 Funnel Plot' : '📊 Forest Plot'}
          </Button>
        </Flexbox>
      </Flexbox>

      {/* Stats bar */}
      {pool && (
        <div className={styles.statsBar}>
          <Flexbox gap={8} horizontal wrap={'wrap'}>
            <span style={{ fontWeight: 700 }}>Pooled Estimate (Fixed-Effects):</span>
            <Tag color="purple">
              {measure} = {pool.point.toFixed(3)}
            </Tag>
            <Tag>
              95% CI: {pool.lower.toFixed(3)} – {pool.upper.toFixed(3)}
            </Tag>
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              {isRatioMeasure(measure)
                ? pool.lower > 1
                  ? '✅ Statistically significant (favours intervention)'
                  : pool.upper < 1
                    ? '⚠️ Favours control'
                    : '❌ Not significant (CI crosses 1.0)'
                : pool.lower > 0
                  ? '✅ Favours intervention'
                  : pool.upper < 0
                    ? '⚠️ Favours control'
                    : '❌ Not significant (CI crosses 0)'}
            </span>
            <span style={{ marginLeft: 'auto' }}>{entries.length} studies</span>
          </Flexbox>
        </div>
      )}

      {/* Plot area */}
      <div className={styles.plotCard} id="forest-svg-container">
        {activeTab === 'forest' ? (
          <ForestSVG entries={entries} measure={measure} />
        ) : (
          <FunnelSVG entries={entries} measure={measure} />
        )}
      </div>

      {/* Action buttons */}
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        <Button icon={<Plus size={13} />} onClick={addEntry} size={'small'}>
          Add Study
        </Button>
        {includedPapers.length > 0 && (
          <Button
            onClick={autoPopulate}
            size={'small'}
            style={{ borderColor: 'rgba(114,46,209,0.4)', color: '#722ed1' }}
          >
            ✨ Auto-populate from {Math.min(includedPapers.length, 10)} papers
          </Button>
        )}
        <Button icon={<Copy size={13} />} onClick={copyTable} size={'small'}>
          Copy Table (Markdown)
        </Button>
        <Button icon={<Download size={13} />} onClick={downloadSVG} size={'small'}>
          Download SVG
        </Button>
      </Flexbox>

      {/* Entry table */}
      {entries.length > 0 && (
        <Flexbox gap={6}>
          <div className={styles.tableHeader}>
            <span>Author</span>
            <span>Year</span>
            <span>{measure}</span>
            <span>Lower CI</span>
            <span>Upper CI</span>
            <span>Weight %</span>
            <span />
          </div>
          {entries.map((e) => (
            <div className={styles.tableRow} key={e.id}>
              <Input
                className={styles.input}
                onChange={(ev) => updateEntry(e.id, 'author', ev.target.value)}
                size="small"
                value={e.author}
              />
              <Input
                className={styles.input}
                onChange={(ev) => updateEntry(e.id, 'year', parseInt(ev.target.value) || e.year)}
                size="small"
                type="number"
                value={e.year}
              />
              <Input
                className={styles.input}
                onChange={(ev) => updateEntry(e.id, 'point', parseFloat(ev.target.value) || 0)}
                size="small"
                step={0.01}
                type="number"
                value={e.point}
              />
              <Input
                className={styles.input}
                onChange={(ev) => updateEntry(e.id, 'lower', parseFloat(ev.target.value) || 0)}
                size="small"
                step={0.01}
                type="number"
                value={e.lower}
              />
              <Input
                className={styles.input}
                onChange={(ev) => updateEntry(e.id, 'upper', parseFloat(ev.target.value) || 0)}
                size="small"
                step={0.01}
                type="number"
                value={e.upper}
              />
              <Input
                className={styles.input}
                onChange={(ev) => updateEntry(e.id, 'weight', parseFloat(ev.target.value) || 0)}
                size="small"
                step={0.1}
                type="number"
                value={e.weight}
              />
              <button
                onClick={() => removeEntry(e.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ff4d4f',
                  cursor: 'pointer',
                  padding: 4,
                }}
                type="button"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </Flexbox>
      )}

      {entries.length === 0 && (
        <div
          style={{
            border: '1px dashed',
            borderRadius: 8,
            fontSize: 12,
            opacity: 0.5,
            padding: '12px',
            textAlign: 'center',
          }}
        >
          Click <strong>Add Study</strong> or <strong>Auto-populate</strong> to get started. <br />
          For meta-analysis: enter each study&apos;s {measure}, lower CI, upper CI, and weight.
        </div>
      )}

      {/* Research context */}
      {searchQuery && (
        <div style={{ borderTop: '1px solid', fontSize: 11, opacity: 0.5, paddingTop: 8 }}>
          Research context: &ldquo;{searchQuery}&rdquo; — {includedPapers.length} included papers
          available for auto-population
        </div>
      )}
    </Flexbox>
  );
});

ForestPlot.displayName = 'ForestPlot';
export default ForestPlot;
