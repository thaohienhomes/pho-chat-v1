'use client';

/**
 * RoB 2 — Risk of Bias Assessment Tool (Cochrane RoB 2 for RCTs)
 *
 * 5 Domains per paper:
 *   D1. Randomization process
 *   D2. Deviations from intended interventions
 *   D3. Missing outcome data
 *   D4. Measurement of the outcome
 *   D5. Selection of the reported result
 *
 * Each domain → Low / Some Concerns / High Risk
 * Overall → auto-derived from domain ratings
 */
import { Tag } from '@lobehub/ui';
import { Select, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { AlertCircle, CheckCircle, Copy, XCircle } from 'lucide-react';
import React, { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { type PaperResult, useResearchStore } from '@/store/research';

// ── Types ────────────────────────────────────────────────────────────────────
type RoBRating = 'high' | 'low' | 'some_concerns';
type DomainKey = 'd1' | 'd2' | 'd3' | 'd4' | 'd5';

interface PaperRoB {
  d1: RoBRating;
  d2: RoBRating;
  d3: RoBRating;
  d4: RoBRating;
  d5: RoBRating;
  notes: string;
}

const DEFAULT_ROB: PaperRoB = {
  d1: 'low',
  d2: 'low',
  d3: 'low',
  d4: 'low',
  d5: 'low',
  notes: '',
};

// ── Domain definitions ────────────────────────────────────────────────────────
const DOMAINS: Array<{ desc: string; guidance: string; key: DomainKey; label: string }> = [
  {
    desc: 'Randomization process',
    guidance: 'Was the allocation sequence truly random? Was allocation adequately concealed?',
    key: 'd1',
    label: 'D1 — Randomization',
  },
  {
    desc: 'Deviations from interventions',
    guidance:
      'Were participants aware of their assigned intervention? Were there deviations due to the trial context?',
    key: 'd2',
    label: 'D2 — Blinding of participants',
  },
  {
    desc: 'Missing outcome data',
    guidance:
      'Were missing outcome data balanced between groups? Could the missing data have been influenced by the true outcome?',
    key: 'd3',
    label: 'D3 — Missing outcome data',
  },
  {
    desc: 'Measurement of the outcome',
    guidance:
      'Was measurement appropriate? Were assessors blinded to group assignment? Was the method applied consistently?',
    key: 'd4',
    label: 'D4 — Outcome measurement',
  },
  {
    desc: 'Selection of the reported result',
    guidance:
      'Were results pre-specified? Were multiple analyses performed and selectively reported?',
    key: 'd5',
    label: 'D5 — Reporting bias',
  },
];

const ROB_OPTIONS: Array<{
  color: string;
  icon: React.ReactNode;
  label: string;
  value: RoBRating;
}> = [
  { color: '#52c41a', icon: <CheckCircle size={12} />, label: 'Low risk', value: 'low' },
  {
    color: '#faad14',
    icon: <AlertCircle size={12} />,
    label: 'Some concerns',
    value: 'some_concerns',
  },
  { color: '#ff4d4f', icon: <XCircle size={12} />, label: 'High risk', value: 'high' },
];

// ── Style ─────────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  cell: css`
    width: 120px;
    min-width: 100px;
    max-width: 140px;
    text-align: center;
  `,
  container: css`
    overflow: hidden;
    width: 100%;
  `,
  domainHeader: css`
    width: 120px;
    min-width: 100px;
    max-width: 140px;

    font-size: 10px;
    font-weight: 700;
    color: ${token.colorTextSecondary};
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
  heatCell: css`
    display: flex;
    align-items: center;
    justify-content: center;

    height: 32px;
    border-radius: 4px;
  `,
  legend: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;

    font-size: 11px;
    color: ${token.colorTextSecondary};
  `,
  notesInput: css`
    resize: vertical;

    width: 100%;
    min-height: 40px;
    padding-block: 4px;
    padding-inline: 8px;
    border: 1px solid ${token.colorBorder};
    border-radius: 4px;

    font-size: 11px;
    color: ${token.colorText};

    background: ${token.colorBgContainer};

    &:focus {
      outline: 2px solid ${token.colorPrimary};
    }
  `,
  overallBadge: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 3px;
    padding-inline: 10px;
    border-radius: 10px;

    font-size: 11px;
    font-weight: 700;
  `,
  paperName: css`
    overflow: hidden;

    max-width: 180px;

    font-size: 12px;
    font-weight: 600;
    color: ${token.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  scrollTable: css`
    overflow-x: auto;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
  `,
  statsCard: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  tableHeader: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    display: flex;
    gap: 8px;
    align-items: flex-start;

    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    background: ${token.colorFillQuaternary};
  `,
  tableRow: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${token.colorBorder};

    &:last-child {
      border-block-end: none;
    }

    &:hover {
      background: ${token.colorFillQuaternary};
    }
  `,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const getOverall = (rob: PaperRoB): RoBRating => {
  const ratings = new Set([rob.d1, rob.d2, rob.d3, rob.d4, rob.d5]);
  if (ratings.has('high')) return 'high';
  if (ratings.has('some_concerns')) return 'some_concerns';
  return 'low';
};

const getRatingConfig = (r: RoBRating) => ROB_OPTIONS.find((o) => o.value === r) ?? ROB_OPTIONS[0];

const inferStudyType = (paper: PaperResult): string => {
  const t = paper.title.toLowerCase();
  if (t.includes('meta-analysis') || t.includes('meta analysis')) return 'Meta-analysis';
  if (t.includes('systematic review')) return 'Systematic Review';
  if (t.includes('randomized') || t.includes('randomised') || t.includes('rct')) return 'RCT';
  if (t.includes('cohort')) return 'Cohort Study';
  if (t.includes('case-control') || t.includes('case control')) return 'Case-Control';
  if (t.includes('cross-sectional')) return 'Cross-sectional';
  if (t.includes('trial')) return 'Clinical Trial';
  if (t.includes('review')) return 'Review';
  return 'Observational';
};

const fmtRoB = (r: RoBRating): string =>
  r === 'low' ? '🟢 Low' : r === 'some_concerns' ? '🟡 Concerns' : '🔴 High';

// ── Component ─────────────────────────────────────────────────────────────────
const RiskOfBias = memo(() => {
  const { styles } = useStyles();

  const papers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);

  const includedPapers = useMemo(
    () => papers.filter((p) => screeningDecisions[p.id]?.decision === 'included'),
    [papers, screeningDecisions],
  );

  // State: rob ratings per paper
  const [robRatings, setRobRatings] = useState<Record<string, PaperRoB>>(() => {
    // Auto-initialise with heuristic guesses based on study type
    const init: Record<string, PaperRoB> = {};
    for (const p of includedPapers) {
      const type = inferStudyType(p);
      const isRCT = ['RCT', 'Clinical Trial'].includes(type);
      const isObs = ['Cohort Study', 'Case-Control', 'Cross-sectional', 'Observational'].includes(
        type,
      );
      init[p.id] = {
        ...DEFAULT_ROB,
        d3: isObs ? 'some_concerns' : 'low',
        d4: isObs ? 'some_concerns' : 'low',
        d5: isRCT ? 'low' : 'some_concerns',
      };
    }
    return init;
  });

  const updateRating = useCallback((paperId: string, domain: DomainKey, value: RoBRating) => {
    setRobRatings((prev) => ({
      ...prev,
      [paperId]: { ...(prev[paperId] ?? DEFAULT_ROB), [domain]: value },
    }));
  }, []);

  const updateNotes = useCallback((paperId: string, notes: string) => {
    setRobRatings((prev) => ({
      ...prev,
      [paperId]: { ...(prev[paperId] ?? DEFAULT_ROB), notes },
    }));
  }, []);

  // Summary stats
  const overallStats = useMemo(() => {
    const stats = { high: 0, low: 0, some_concerns: 0 };
    for (const p of includedPapers) {
      const rob = robRatings[p.id] ?? DEFAULT_ROB;
      stats[getOverall(rob)]++;
    }
    return stats;
  }, [includedPapers, robRatings]);

  // Export RoB table as markdown
  const exportMarkdown = useCallback(() => {
    const header = '| Study | D1 | D2 | D3 | D4 | D5 | Overall |';
    const sep = '|---|---|---|---|---|---|---|';
    const rows = includedPapers.map((p) => {
      const rob = robRatings[p.id] ?? DEFAULT_ROB;
      return `| ${p.title.slice(0, 40)}... | ${fmtRoB(rob.d1)} | ${fmtRoB(rob.d2)} | ${fmtRoB(rob.d3)} | ${fmtRoB(rob.d4)} | ${fmtRoB(rob.d5)} | ${fmtRoB(getOverall(rob))} |`;
    });
    const md = [header, sep, ...rows].join('\n');
    navigator.clipboard.writeText(md);
  }, [includedPapers, robRatings]);

  if (includedPapers.length === 0) {
    return (
      <Flexbox
        align={'center'}
        gap={8}
        justify={'center'}
        style={{ padding: 48, textAlign: 'center' }}
      >
        <span style={{ fontSize: 40 }}>⚖️</span>
        <span style={{ fontSize: 15, fontWeight: 600 }}>No included papers</span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          Include papers in the Screening phase first.
        </span>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            ⚖️ Risk of Bias Assessment (Cochrane RoB 2)
          </span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Tool for randomized controlled trials — rate each domain per study
          </span>
        </Flexbox>
        <button
          onClick={exportMarkdown}
          style={{
            alignItems: 'center',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6,
            color: 'inherit',
            cursor: 'pointer',
            display: 'flex',
            fontSize: 11,
            gap: 4,
            padding: '4px 10px',
          }}
          type="button"
        >
          <Copy size={11} /> Copy Markdown
        </button>
      </Flexbox>

      {/* Summary Stats */}
      <div className={styles.statsCard}>
        <Flexbox gap={8} horizontal wrap={'wrap'}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Overall Bias Distribution:</span>
          <Flexbox gap={6} horizontal>
            <span
              className={styles.overallBadge}
              style={{ background: '#52c41a20', color: '#52c41a' }}
            >
              <CheckCircle size={11} /> Low: {overallStats.low}
            </span>
            <span
              className={styles.overallBadge}
              style={{ background: '#faad1420', color: '#faad14' }}
            >
              <AlertCircle size={11} /> Concerns: {overallStats.some_concerns}
            </span>
            <span
              className={styles.overallBadge}
              style={{ background: '#ff4d4f20', color: '#ff4d4f' }}
            >
              <XCircle size={11} /> High: {overallStats.high}
            </span>
          </Flexbox>
          <span style={{ fontSize: 11, marginLeft: 'auto', opacity: 0.5 }}>
            {includedPapers.length} studies assessed
          </span>
        </Flexbox>
      </div>

      {/* RoB Heat-Map Table */}
      <div className={styles.scrollTable}>
        {/* Table Header */}
        <div className={styles.tableHeader}>
          <div style={{ minWidth: 180 }}>
            <span
              style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase' }}
            >
              Study
            </span>
          </div>
          {DOMAINS.map((d) => (
            <Tooltip key={d.key} title={d.guidance}>
              <div className={styles.domainHeader}>
                {d.key.toUpperCase()}
                <br />
                <span
                  style={{ fontSize: 9, fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}
                >
                  {d.desc}
                </span>
              </div>
            </Tooltip>
          ))}
          <div className={styles.domainHeader}>Overall</div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              minWidth: 130,
              opacity: 0.5,
              textTransform: 'uppercase',
            }}
          >
            Notes
          </div>
        </div>

        {/* Paper rows */}
        {includedPapers.map((paper) => {
          const rob = robRatings[paper.id] ?? DEFAULT_ROB;
          const overall = getOverall(rob);
          const overallCfg = getRatingConfig(overall);

          return (
            <div className={styles.tableRow} key={paper.id}>
              {/* Study title + type */}
              <div style={{ minWidth: 180 }}>
                <Tooltip title={paper.title}>
                  <div className={styles.paperName}>{paper.title}</div>
                </Tooltip>
                <Tag color="blue" style={{ fontSize: 9, marginTop: 2 }}>
                  {inferStudyType(paper)}
                </Tag>
                <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.5 }}>{paper.year}</span>
              </div>

              {/* Domain dropdowns */}
              {DOMAINS.map((d) => {
                const val = rob[d.key];
                const cfg = getRatingConfig(val);
                return (
                  <div className={styles.cell} key={d.key}>
                    <div
                      className={styles.heatCell}
                      style={{ background: cfg.color + '22', cursor: 'pointer' }}
                    >
                      <Select
                        onChange={(v) => updateRating(paper.id, d.key, v as RoBRating)}
                        options={ROB_OPTIONS.map((o) => ({
                          label: (
                            <Flexbox align={'center'} gap={4} horizontal>
                              <span style={{ color: o.color }}>{o.icon}</span>
                              {o.label}
                            </Flexbox>
                          ),
                          value: o.value,
                        }))}
                        size="small"
                        style={{ fontSize: 10, width: 110 }}
                        value={val}
                        variant="borderless"
                      />
                    </div>
                  </div>
                );
              })}

              {/* Overall */}
              <div className={styles.cell}>
                <div
                  className={styles.heatCell}
                  style={{
                    background: overallCfg.color + '30',
                    color: overallCfg.color,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {overallCfg.icon}
                </div>
              </div>

              {/* Notes */}
              <div style={{ minWidth: 130 }}>
                <textarea
                  className={styles.notesInput}
                  onChange={(e) => updateNotes(paper.id, e.target.value)}
                  placeholder="Notes..."
                  value={rob.notes}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className={styles.legend}>
        <span style={{ fontWeight: 600 }}>Domain guide:</span>
        {DOMAINS.map((d) => (
          <span key={d.key}>
            <strong>{d.key.toUpperCase()}.</strong> {d.desc}
          </span>
        ))}
      </div>
      <div className={styles.legend}>
        <span style={{ fontWeight: 600 }}>Rating:</span>
        {ROB_OPTIONS.map((o) => (
          <span
            key={o.value}
            style={{ alignItems: 'center', color: o.color, display: 'flex', gap: 3 }}
          >
            {o.icon} {o.label}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>
          Overall = High if any High; Some Concerns if any; Low if all Low
        </span>
      </div>
    </Flexbox>
  );
});

RiskOfBias.displayName = 'RiskOfBias';
export default RiskOfBias;
