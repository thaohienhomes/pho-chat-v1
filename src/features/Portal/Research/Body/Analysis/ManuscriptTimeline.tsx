'use client';

/**
 * Manuscript Timeline Generator
 *
 * Generates a Gantt-style project timeline for systematic review publication.
 * - Pre-defined phases with estimated durations
 * - User sets start date and adjusts phase durations
 * - Renders an SVG Gantt chart with color-coded phases
 * - Exports as Markdown table or downloads SVG
 */
import { Button, Tag } from '@lobehub/ui';
import { DatePicker } from 'antd';
import { createStyles } from 'antd-style';
import dayjs, { type Dayjs } from 'dayjs';
import { Copy, Download } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Phase {
  color: string;
  description: string;
  durationWeeks: number;
  emoji: string;
  id: string;
  label: string;
}

// ── Default phases ────────────────────────────────────────────────────────────
const DEFAULT_PHASES: Phase[] = [
  {
    color: '#1890ff',
    description: 'PICO, search strategy, PROSPERO registration',
    durationWeeks: 2,
    emoji: '🎯',
    id: 'planning',
    label: 'Planning & Protocol',
  },
  {
    color: '#13c2c2',
    description: 'Database searches across PubMed, Embase, Cochrane, etc.',
    durationWeeks: 1,
    emoji: '🔍',
    id: 'search',
    label: 'Literature Search',
  },
  {
    color: '#722ed1',
    description: 'Title/abstract screening + full-text assessment',
    durationWeeks: 3,
    emoji: '📋',
    id: 'screening',
    label: 'Screening & Selection',
  },
  {
    color: '#fa8c16',
    description: 'Data extraction form, double-extraction, reconciliation',
    durationWeeks: 3,
    emoji: '📊',
    id: 'extraction',
    label: 'Data Extraction',
  },
  {
    color: '#ff4d4f',
    description: 'Cochrane RoB 2, GRADE, ROBINS-I',
    durationWeeks: 2,
    emoji: '⚖️',
    id: 'rob',
    label: 'Risk of Bias Assessment',
  },
  {
    color: '#eb2f96',
    description: 'Meta-analysis, forest plot, funnel plot, subgroups',
    durationWeeks: 3,
    emoji: '📈',
    id: 'analysis',
    label: 'Statistical Analysis',
  },
  {
    color: '#52c41a',
    description: 'Introduction, methods, results, discussion, abstract',
    durationWeeks: 4,
    emoji: '✍️',
    id: 'writing',
    label: 'Manuscript Writing',
  },
  {
    color: '#faad14',
    description: 'Internal review by co-authors (2 rounds)',
    durationWeeks: 2,
    emoji: '👥',
    id: 'internal',
    label: 'Internal Review',
  },
  {
    color: '#a0d911',
    description: 'Journal selection, formatting, cover letter',
    durationWeeks: 1,
    emoji: '📤',
    id: 'submission',
    label: 'Submission Preparation',
  },
  {
    color: '#8c8c8c',
    description: 'Await peer review decision',
    durationWeeks: 8,
    emoji: '⏳',
    id: 'peerreview',
    label: 'Peer Review (avg)',
  },
  {
    color: '#1890ff',
    description: 'Address reviewer comments, letter to editor',
    durationWeeks: 4,
    emoji: '🔄',
    id: 'revision',
    label: 'Revision',
  },
  {
    color: '#52c41a',
    description: 'Final decision and online publication',
    durationWeeks: 2,
    emoji: '🎉',
    id: 'publication',
    label: 'Acceptance & Publication',
  },
];

// ── Styles ────────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  chart: css`
    overflow-x: auto;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  container: css`
    width: 100%;
  `,
  phaseRow: css`
    display: grid;
    grid-template-columns: 200px 80px 1fr;
    gap: 8px;
    align-items: center;

    padding-block: 5px;
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
  statsBar: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: ${token.borderRadiusLG}px;

    background: linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorFillQuaternary});
  `,
  weekInput: css`
    width: 50px;
    padding-block: 2px;
    padding-inline: 6px;
    border: 1px solid ${token.colorBorder};
    border-radius: 4px;

    font-size: 11px;
    color: ${token.colorText};
    text-align: center;

    background: ${token.colorBgContainer};

    &:focus {
      outline: 2px solid ${token.colorPrimary};
    }
  `,
}));

// ── SVG Gantt Chart ───────────────────────────────────────────────────────────
const GANTT_W = 900;
const ROW_H = 28;
const LABEL_W = 210;
const PADDING = 12;

const GanttChart = ({ phases, startDate }: { phases: Phase[]; startDate: Dayjs }) => {
  const totalWeeks = phases.reduce((s, p) => s + p.durationWeeks, 0);
  const svgH = phases.length * ROW_H + PADDING * 2 + 28; // +28 for header

  // Week scale
  const weekW = (GANTT_W - LABEL_W - PADDING * 2) / totalWeeks;

  let cumWeeks = 0;
  const rows = phases.map((p) => {
    const start = cumWeeks;
    cumWeeks += p.durationWeeks;
    const x = LABEL_W + PADDING + start * weekW;
    const w = p.durationWeeks * weekW - 2;
    const y = PADDING + 28 + phases.indexOf(p) * ROW_H;
    const startD = startDate.add(start, 'week');
    const endD = startDate.add(cumWeeks, 'week');
    return { ...p, endD, startD, w, x, y };
  });

  // Month grid lines
  const monthLines: number[] = [];
  let cur = startDate.startOf('month').add(1, 'month');
  const endDate = startDate.add(totalWeeks, 'week');
  while (cur.isBefore(endDate)) {
    const diffWeeks = cur.diff(startDate, 'week');
    monthLines.push(LABEL_W + PADDING + diffWeeks * weekW);
    cur = cur.add(1, 'month');
  }

  return (
    <svg
      height={svgH}
      style={{ display: 'block', minWidth: GANTT_W }}
      viewBox={`0 0 ${GANTT_W} ${svgH}`}
      width="100%"
    >
      {/* Background stripes */}
      {rows.map((r, i) => (
        <rect
          fill={i % 2 === 0 ? 'rgba(0,0,0,0.02)' : 'transparent'}
          height={ROW_H}
          key={r.id}
          width={GANTT_W}
          x={0}
          y={r.y}
        />
      ))}

      {/* Month grid lines */}
      {monthLines.map((x, i) => (
        <line
          key={i}
          stroke="rgba(128,128,128,0.2)"
          strokeDasharray="4,3"
          x1={x}
          x2={x}
          y1={PADDING}
          y2={svgH - PADDING}
        />
      ))}

      {/* Header */}
      <text
        fill="rgba(128,128,128,0.8)"
        fontSize={10}
        fontWeight={700}
        x={LABEL_W + PADDING}
        y={PADDING + 16}
      >
        {rows.map((r) => null)}
        Week 1 → Week {totalWeeks} | {startDate.format('MMM YYYY')} → {endDate.format('MMM YYYY')}
      </text>

      {/* Phase bars */}
      {rows.map((r) => (
        <g key={r.id}>
          {/* Phase label */}
          <text
            fill="rgba(180,180,180,0.9)"
            fontSize={10}
            textAnchor="end"
            x={LABEL_W - 6}
            y={r.y + ROW_H / 2 + 4}
          >
            {r.emoji} {r.label}
          </text>

          {/* Bar */}
          <rect
            fill={r.color}
            height={ROW_H - 6}
            opacity={0.85}
            rx={4}
            ry={4}
            width={Math.max(r.w, 4)}
            x={r.x}
            y={r.y + 3}
          />

          {/* Duration label inside bar */}
          {r.w > 40 && (
            <text fill="#fff" fontSize={9} fontWeight={600} x={r.x + 6} y={r.y + ROW_H / 2 + 3.5}>
              {r.durationWeeks}w · {r.startD.format('D MMM')}
            </text>
          )}
        </g>
      ))}

      {/* Today line — just start date */}
      <line
        stroke="#ff4d4f"
        strokeDasharray="5,3"
        strokeWidth={1.5}
        x1={LABEL_W + PADDING}
        x2={LABEL_W + PADDING}
        y1={PADDING + 20}
        y2={svgH - PADDING}
      />
      <text fill="#ff4d4f" fontSize={8} x={LABEL_W + PADDING + 2} y={PADDING + 20}>
        START
      </text>
    </svg>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const ManuscriptTimeline = memo(() => {
  const { styles } = useStyles();
  const [phases, setPhases] = useState<Phase[]>(DEFAULT_PHASES);
  const [startDate, setStartDate] = useState<Dayjs>(dayjs());
  const [copied, setCopied] = useState(false);

  const totalWeeks = useMemo(() => phases.reduce((s, p) => s + p.durationWeeks, 0), [phases]);
  const endDate = useMemo(() => startDate.add(totalWeeks, 'week'), [startDate, totalWeeks]);
  const months = Math.round(totalWeeks / 4.33);

  const updatePhase = useCallback((id: string, weeks: number) => {
    setPhases((prev) =>
      prev.map((p) => (p.id === id ? { ...p, durationWeeks: Math.max(1, weeks) } : p)),
    );
  }, []);

  const copyMarkdown = useCallback(() => {
    const header = '| Phase | Duration | Start | End | Description |\n|---|---|---|---|---|';
    let cumW = 0;
    const rows = phases.map((p) => {
      const s = startDate.add(cumW, 'week');
      cumW += p.durationWeeks;
      const e = startDate.add(cumW, 'week');
      return `| ${p.emoji} ${p.label} | ${p.durationWeeks} weeks | ${s.format('DD/MM/YYYY')} | ${e.format('DD/MM/YYYY')} | ${p.description} |`;
    });
    const md = `# Systematic Review Timeline\n\n**Start:** ${startDate.format('DD/MM/YYYY')}  **End:** ${endDate.format('DD/MM/YYYY')}  **Total:** ~${months} months\n\n${[header, ...rows].join('\n')}`;
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [phases, startDate, endDate, months]);

  const downloadSVG = useCallback(() => {
    const svgEl = document.querySelector('#gantt-svg-chart');
    if (!svgEl) return;
    const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manuscript-timeline.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const resetPhases = useCallback(() => setPhases(DEFAULT_PHASES), []);

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📅 Manuscript Timeline Generator</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Gantt chart for systematic review publication — customize phases and export
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal>
          <DatePicker
            format="DD/MM/YYYY"
            onChange={(d) => d && setStartDate(d)}
            placeholder="Start date"
            size="small"
            value={startDate}
          />
          <Button icon={<Copy size={12} />} onClick={copyMarkdown} size={'small'}>
            {copied ? '✓ Copied!' : 'Copy Table'}
          </Button>
          <Button icon={<Download size={12} />} onClick={downloadSVG} size={'small'}>
            SVG
          </Button>
        </Flexbox>
      </Flexbox>

      {/* Stats bar */}
      <div className={styles.statsBar}>
        <Flexbox gap={6} horizontal wrap={'wrap'}>
          <Tag color="blue">Start: {startDate.format('DD/MM/YYYY')}</Tag>
          <Tag color="green">End: {endDate.format('DD/MM/YYYY')}</Tag>
          <Tag color="purple">
            Total: {totalWeeks} weeks (~{months} months)
          </Tag>
          <Tag>{phases.length} phases</Tag>
          <button
            onClick={resetPhases}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4,
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 11,
              marginLeft: 'auto',
              padding: '2px 8px',
            }}
            type="button"
          >
            Reset to defaults
          </button>
        </Flexbox>
      </div>

      {/* Phase editor */}
      <Flexbox gap={4}>
        <span style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
          ⚙️ Adjust phase durations (weeks)
        </span>
        {phases.map((phase) => (
          <div className={styles.phaseRow} key={phase.id}>
            <Flexbox align={'center'} gap={6} horizontal>
              <div
                style={{
                  background: phase.color,
                  borderRadius: 2,
                  flexShrink: 0,
                  height: 10,
                  width: 10,
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 600 }}>
                {phase.emoji} {phase.label}
              </span>
            </Flexbox>
            <Flexbox align={'center'} gap={4} horizontal>
              <button
                onClick={() => updatePhase(phase.id, phase.durationWeeks - 1)}
                style={{
                  background: 'transparent',
                  border: '1px solid',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                  padding: '1px 5px',
                }}
                type="button"
              >
                −
              </button>
              <input
                className={styles.weekInput}
                min={1}
                onChange={(e) => updatePhase(phase.id, Number(e.target.value))}
                type="number"
                value={phase.durationWeeks}
              />
              <button
                onClick={() => updatePhase(phase.id, phase.durationWeeks + 1)}
                style={{
                  background: 'transparent',
                  border: '1px solid',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                  padding: '1px 5px',
                }}
                type="button"
              >
                +
              </button>
              <Tag style={{ fontSize: 9, marginLeft: 4 }}>{phase.durationWeeks}w</Tag>
            </Flexbox>
            <span
              style={{
                fontSize: 10,
                opacity: 0.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {phase.description}
            </span>
          </div>
        ))}
      </Flexbox>

      {/* Gantt chart */}
      <div className={styles.chart} id="gantt-svg-chart">
        <GanttChart phases={phases} startDate={startDate} />
      </div>

      {/* Tip */}
      <div style={{ fontSize: 11, opacity: 0.5 }}>
        💡 Average systematic review takes <strong>12–18 months</strong> from protocol registration
        to publication. High-priority journals (Lancet, NEJM) may require 6–12 months of peer
        review.
      </div>
    </Flexbox>
  );
});

ManuscriptTimeline.displayName = 'ManuscriptTimeline';
export default ManuscriptTimeline;
