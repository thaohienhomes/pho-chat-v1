'use client';

/**
 * GRADE Summary of Findings (SoF) Table Generator
 *
 * GRADE (Grading of Recommendations Assessment, Development and Evaluation)
 * rates the certainty of evidence for each outcome on 4 domains:
 *   1. Risk of bias
 *   2. Inconsistency (heterogeneity)
 *   3. Indirectness
 *   4. Imprecision
 *   5. Publication bias (optional 5th)
 *
 * Outputs a standard Cochrane-style Summary of Findings table
 * that can be copied as Markdown or exported.
 */
import { Button, Tag } from '@lobehub/ui';
import { Select } from 'antd';
import { createStyles } from 'antd-style';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

// ── Types ─────────────────────────────────────────────────────────────────────
type GRAdELevel = 'high' | 'moderate' | 'low' | 'very_low';
type DomainRating = 'no' | 'serious' | 'very_serious' | 'not_assessed';
type EffectDirection = 'benefit' | 'harm' | 'no_difference' | 'unclear';

interface GradeOutcome {
  absoluteEffect: string; // e.g., "120 fewer per 1000"
  domains: {
    bias: DomainRating;
    imprecision: DomainRating;
    inconsistency: DomainRating;
    indirectness: DomainRating;
    publication: DomainRating;
  };
  effectDirection: EffectDirection;
  followUp: string; // e.g., "12 months"
  id: string;
  importance: 'critical' | 'important' | 'limited';
  name: string;
  noOfParticipants: number;
  noOfStudies: number;
  relativeEffect: string; // e.g., "RR 0.72 (95% CI 0.62–0.84)"
  studyDesign: string; // e.g., "Randomised trials"
}

// ── GRADE calculation ─────────────────────────────────────────────────────────
const calcGrade = (outcome: GradeOutcome): GRAdELevel => {
  // Start: RCT = high, Obs = low
  let points = outcome.studyDesign.toLowerCase().includes('random') ? 4 : 2;

  const deduct = (r: DomainRating) => {
    if (r === 'serious') points -= 1;
    if (r === 'very_serious') points -= 2;
  };

  deduct(outcome.domains.bias);
  deduct(outcome.domains.inconsistency);
  deduct(outcome.domains.indirectness);
  deduct(outcome.domains.imprecision);
  deduct(outcome.domains.publication);

  if (points >= 4) return 'high';
  if (points === 3) return 'moderate';
  if (points === 2) return 'low';
  return 'very_low';
};

const GRADE_CONFIG: Record<
  GRAdELevel,
  { color: string; emoji: string; label: string; stars: string }
> = {
  high: { color: '#52c41a', emoji: '⊕⊕⊕⊕', label: 'High', stars: '4/4' },
  low: { color: '#faad14', emoji: '⊕⊕⊝⊝', label: 'Low', stars: '2/4' },
  moderate: { color: '#1890ff', emoji: '⊕⊕⊕⊝', label: 'Moderate', stars: '3/4' },
  very_low: { color: '#ff4d4f', emoji: '⊕⊝⊝⊝', label: 'Very low', stars: '1/4' },
};

const CERTAINTY_FOOTNOTE: Record<GRAdELevel, string> = {
  high: 'We are very confident that the true effect lies close to that of the estimate.',
  low: 'Our confidence in the effect estimate is limited; the true effect may be substantially different.',
  moderate:
    'We are moderately confident in the effect estimate; the true effect is likely close to the estimate.',
  very_low:
    'We have very little confidence in the effect estimate; the true effect is likely substantially different.',
};

// ── Domain options ─────────────────────────────────────────────────────────────
const DOMAIN_OPTIONS = [
  { label: 'Not serious', value: 'no' },
  { label: 'Serious (−1)', value: 'serious' },
  { label: 'Very serious (−2)', value: 'very_serious' },
  { label: 'N/A', value: 'not_assessed' },
];

const DOMAIN_LABELS = {
  bias: 'Risk of bias',
  imprecision: 'Imprecision',
  inconsistency: 'Inconsistency',
  indirectness: 'Indirectness',
  publication: 'Publication bias',
};

const IMPORTANCE_OPTIONS = [
  { label: '🔴 Critical', value: 'critical' },
  { label: '🟡 Important', value: 'important' },
  { label: '🟢 Limited importance', value: 'limited' },
];

// ── Styles ────────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  container: css`
    width: 100%;
  `,
  domainGrid: css`
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  `,
  gradeCell: css`
    padding: 8px;
    border-radius: 6px;

    font-size: 12px;
    font-weight: 900;
    text-align: center;
  `,
  outcomeCard: css`
    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};

    transition: border-color 0.2s;
  `,
  sofTable: css`
    border-collapse: collapse;
    width: 100%;
    font-size: 11px;

    th {
      padding-block: 6px;
      padding-inline: 10px;

      font-weight: 700;
      text-align: start;

      background: ${token.colorFillSecondary};
    }

    td {
      padding-block: 6px;
      padding-inline: 10px;
      border-block-end: 1px solid ${token.colorBorder};
      vertical-align: top;
    }

    tr:last-child td {
      border-block-end: none;
    }

    tr:hover td {
      background: ${token.colorFillQuaternary};
    }
  `,
  titleInput: css`
    width: 100%;
    padding-block: 4px;
    padding-inline: 8px;
    border: 1px solid transparent;
    border-radius: 4px;

    font-size: 13px;
    font-weight: 600;
    color: inherit;

    background: transparent;

    &:hover,
    &:focus {
      border-color: ${token.colorBorder};
      background: ${token.colorFillQuaternary};
      outline: none;
    }
  `,
  valueInput: css`
    width: 100%;
    padding-block: 2px;
    padding-inline: 6px;
    border: 1px solid transparent;
    border-radius: 4px;

    font-size: 11px;
    color: inherit;

    background: transparent;

    &:hover,
    &:focus {
      border-color: ${token.colorBorder};
      background: ${token.colorBgContainer};
      outline: none;
    }
  `,
}));

// ── Default outcomes ──────────────────────────────────────────────────────────
const defaultDomains = (): GradeOutcome['domains'] => ({
  bias: 'no',
  imprecision: 'no',
  inconsistency: 'no',
  indirectness: 'no',
  publication: 'not_assessed',
});

const newOutcome = (n: number): GradeOutcome => ({
  absoluteEffect: '',
  domains: defaultDomains(),
  effectDirection: 'benefit',
  followUp: '',
  id: `outcome-${Date.now()}-${n}`,
  importance: 'critical',
  name: `Outcome ${n + 1}`,
  noOfParticipants: 0,
  noOfStudies: 0,
  relativeEffect: '',
  studyDesign: 'Randomised trials',
});

const DEFAULT_OUTCOMES: GradeOutcome[] = [
  {
    absoluteEffect: '120 fewer per 1,000 (95% CI 94 fewer to 140 fewer)',
    domains: {
      bias: 'no',
      imprecision: 'no',
      inconsistency: 'serious',
      indirectness: 'no',
      publication: 'not_assessed',
    },
    effectDirection: 'benefit',
    followUp: '12 months',
    id: 'o1',
    importance: 'critical',
    name: 'All-cause mortality',
    noOfParticipants: 12_400,
    noOfStudies: 8,
    relativeEffect: 'RR 0.72 (95% CI 0.62–0.84)',
    studyDesign: 'Randomised trials',
  },
  {
    absoluteEffect: '45 fewer per 1,000 (95% CI 10 fewer to 82 fewer)',
    domains: {
      bias: 'serious',
      imprecision: 'serious',
      inconsistency: 'no',
      indirectness: 'no',
      publication: 'not_assessed',
    },
    effectDirection: 'benefit',
    followUp: '12 months',
    id: 'o2',
    importance: 'critical',
    name: 'Adverse events (serious)',
    noOfParticipants: 9200,
    noOfStudies: 6,
    relativeEffect: 'RR 0.88 (95% CI 0.78–0.98)',
    studyDesign: 'Randomised trials',
  },
];

// ── Domain rating badge ───────────────────────────────────────────────────────
const domainBadge = (r: DomainRating) => {
  if (r === 'no') return null;
  if (r === 'not_assessed') return null;
  return (
    <span
      style={{ color: r === 'very_serious' ? '#ff4d4f' : '#faad14', fontSize: 9, fontWeight: 700 }}
    >
      {r === 'serious' ? '↓' : '↓↓'}
    </span>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────
const GradeSoF = memo(() => {
  const { styles } = useStyles();
  const [title, setTitle] = useState(
    'Patient or population: [Population]\nSetting: [Setting]\nIntervention: [Intervention]\nComparison: [Comparison]',
  );
  const [outcomes, setOutcomes] = useState<GradeOutcome[]>(DEFAULT_OUTCOMES);
  const [copied, setCopied] = useState(false);

  const updateOutcome = useCallback(
    <K extends keyof GradeOutcome>(id: string, key: K, val: GradeOutcome[K]) => {
      setOutcomes((prev) => prev.map((o) => (o.id === id ? { ...o, [key]: val } : o)));
    },
    [],
  );

  const updateDomain = useCallback(
    (id: string, domain: keyof GradeOutcome['domains'], val: DomainRating) => {
      setOutcomes((prev) =>
        prev.map((o) => (o.id === id ? { ...o, domains: { ...o.domains, [domain]: val } } : o)),
      );
    },
    [],
  );

  const addOutcome = useCallback(() => {
    setOutcomes((prev) => [...prev, newOutcome(prev.length)]);
  }, []);

  const removeOutcome = useCallback((id: string) => {
    setOutcomes((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const copyMarkdown = useCallback(() => {
    const header = `# Summary of Findings Table\n\n${title}\n\n`;
    const cols =
      '| Outcome | Studies (n) | Design | RR/MD (95% CI) | Absolute effect | Certainty | Importance |';
    const sep = '|---|---|---|---|---|---|---|';
    const rows = outcomes.map((o) => {
      const grade = calcGrade(o);
      const cfg = GRADE_CONFIG[grade];
      return `| ${o.name}${o.followUp ? ` (${o.followUp})` : ''} | ${o.noOfStudies} RCTs (${o.noOfParticipants.toLocaleString()} pts) | ${o.studyDesign} | ${o.relativeEffect} | ${o.absoluteEffect} | ${cfg.emoji} **${cfg.label}** | ${o.importance.charAt(0).toUpperCase() + o.importance.slice(1)} |`;
    });
    const table = [cols, sep, ...rows].join('\n');
    const footnotes = `\n\n---\n_Generated by Phở Research Mode using GRADE methodology._`;
    navigator.clipboard.writeText(header + table + footnotes);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [title, outcomes]);

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>🏆 GRADE Summary of Findings Table</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Cochrane-style certainty of evidence rating — required for systematic reviews targeting
            high-impact journals
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal>
          <Button icon={<Copy size={12} />} onClick={copyMarkdown} type={'primary'}>
            {copied ? '✓ Copied!' : 'Copy Markdown'}
          </Button>
        </Flexbox>
      </Flexbox>

      {/* Study info */}
      <div className={styles.card}>
        <Flexbox gap={4}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>📋 Study information</span>
          <textarea
            className={styles.titleInput}
            onChange={(e) => setTitle(e.target.value)}
            rows={4}
            style={{ fontFamily: 'inherit', resize: 'vertical' }}
            value={title}
          />
        </Flexbox>
      </div>

      {/* GRADE scale legend */}
      <Flexbox gap={6} horizontal wrap={'wrap'}>
        {(Object.entries(GRADE_CONFIG) as [GRAdELevel, (typeof GRADE_CONFIG)[GRAdELevel]][]).map(
          ([level, cfg]) => (
            <Flexbox
              align={'center'}
              gap={4}
              horizontal
              key={level}
              style={{
                background: `${cfg.color}18`,
                border: `1px solid ${cfg.color}44`,
                borderRadius: 6,
                padding: '4px 10px',
              }}
            >
              <span style={{ color: cfg.color, fontSize: 13 }}>{cfg.emoji}</span>
              <Flexbox gap={1}>
                <span style={{ color: cfg.color, fontSize: 11, fontWeight: 700 }}>{cfg.label}</span>
                <span style={{ fontSize: 9, maxWidth: 120, opacity: 0.6 }}>
                  {CERTAINTY_FOOTNOTE[level].slice(0, 50)}…
                </span>
              </Flexbox>
            </Flexbox>
          ),
        )}
      </Flexbox>

      {/* Outcomes */}
      {outcomes.map((outcome, i) => {
        const grade = calcGrade(outcome);
        const cfg = GRADE_CONFIG[grade];
        return (
          <div className={styles.outcomeCard} key={outcome.id}>
            <Flexbox gap={10}>
              {/* Outcome header */}
              <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
                <Flexbox align={'center'} gap={6} horizontal>
                  <span style={{ flexShrink: 0, fontSize: 11, opacity: 0.4 }}>#{i + 1}</span>
                  <input
                    className={styles.titleInput}
                    onChange={(e) => updateOutcome(outcome.id, 'name', e.target.value)}
                    placeholder="Outcome name"
                    style={{ fontSize: 13 }}
                    value={outcome.name}
                  />
                  <Select
                    onChange={(v) => updateOutcome(outcome.id, 'importance', v)}
                    options={IMPORTANCE_OPTIONS}
                    size="small"
                    style={{ flexShrink: 0, minWidth: 140 }}
                    value={outcome.importance}
                  />
                </Flexbox>
                <Flexbox align={'center'} gap={4} horizontal>
                  {/* GRADE badge */}
                  <div
                    className={styles.gradeCell}
                    style={{ background: `${cfg.color}20`, color: cfg.color, minWidth: 80 }}
                  >
                    <div style={{ fontSize: 14 }}>{cfg.emoji}</div>
                    <div style={{ fontSize: 10 }}>{cfg.label}</div>
                  </div>
                  <button
                    onClick={() => removeOutcome(outcome.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      opacity: 0.4,
                      padding: 4,
                    }}
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                </Flexbox>
              </Flexbox>

              {/* Basic info row */}
              <Flexbox gap={8} horizontal wrap={'wrap'}>
                {[
                  { key: 'noOfStudies', label: 'Studies (N)', type: 'number' },
                  { key: 'noOfParticipants', label: 'Participants', type: 'number' },
                  { key: 'followUp', label: 'Follow-up', type: 'text' },
                  { key: 'studyDesign', label: 'Design', type: 'text' },
                ].map(({ key, label, type }) => (
                  <Flexbox gap={2} key={key} style={{ flex: 1, minWidth: 100 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.5 }}>{label}</span>
                    <input
                      className={styles.valueInput}
                      onChange={(e) =>
                        updateOutcome(
                          outcome.id,
                          key as keyof GradeOutcome,
                          type === 'number' ? Number(e.target.value) : e.target.value,
                        )
                      }
                      placeholder={label}
                      type={type}
                      value={outcome[key as keyof GradeOutcome] as string | number}
                    />
                  </Flexbox>
                ))}
              </Flexbox>

              {/* Effect estimates */}
              <Flexbox gap={8} horizontal wrap={'wrap'}>
                <Flexbox gap={2} style={{ flex: 2, minWidth: 200 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.5 }}>
                    Relative effect (RR/OR/MD with 95% CI)
                  </span>
                  <input
                    className={styles.valueInput}
                    onChange={(e) => updateOutcome(outcome.id, 'relativeEffect', e.target.value)}
                    placeholder="e.g. RR 0.72 (95% CI 0.62–0.84)"
                    value={outcome.relativeEffect}
                  />
                </Flexbox>
                <Flexbox gap={2} style={{ flex: 2, minWidth: 200 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.5 }}>
                    Absolute effect (per 1,000 patients)
                  </span>
                  <input
                    className={styles.valueInput}
                    onChange={(e) => updateOutcome(outcome.id, 'absoluteEffect', e.target.value)}
                    placeholder="e.g. 120 fewer per 1,000 (95% CI 94–140 fewer)"
                    value={outcome.absoluteEffect}
                  />
                </Flexbox>
              </Flexbox>

              {/* GRADE domains */}
              <Flexbox gap={4}>
                <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.5 }}>
                  GRADE domains (rate each reason for downgrading):
                </span>
                <div className={styles.domainGrid}>
                  {(Object.entries(DOMAIN_LABELS) as [keyof GradeOutcome['domains'], string][]).map(
                    ([domain, label]) => (
                      <Flexbox gap={2} key={domain}>
                        <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.6 }}>{label}</span>
                        <Select
                          onChange={(v: DomainRating) => updateDomain(outcome.id, domain, v)}
                          options={DOMAIN_OPTIONS}
                          size="small"
                          value={outcome.domains[domain]}
                        />
                        {domainBadge(outcome.domains[domain])}
                      </Flexbox>
                    ),
                  )}
                </div>
              </Flexbox>

              {/* Interpretation */}
              <div
                style={{
                  background: `${cfg.color}12`,
                  borderLeft: `3px solid ${cfg.color}`,
                  borderRadius: 6,
                  fontSize: 11,
                  padding: '6px 10px',
                }}
              >
                <strong style={{ color: cfg.color }}>
                  {cfg.emoji} {cfg.label} certainty
                </strong>{' '}
                — {CERTAINTY_FOOTNOTE[grade]}
              </div>
            </Flexbox>
          </div>
        );
      })}

      {/* Add outcome */}
      <Button icon={<Plus size={13} />} onClick={addOutcome} style={{ alignSelf: 'flex-start' }}>
        Add Outcome
      </Button>

      {/* Preview SoF table */}
      <div className={styles.card}>
        <Flexbox gap={8}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>📊 Summary of Findings Preview</span>
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.sofTable}>
              <thead>
                <tr>
                  <th>Outcome</th>
                  <th>Studies (pts)</th>
                  <th>Relative effect</th>
                  <th>Absolute effect</th>
                  <th>Certainty</th>
                  <th>Importance</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => {
                  const grade = calcGrade(o);
                  const cfg = GRADE_CONFIG[grade];
                  return (
                    <tr key={o.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{o.name}</div>
                        {o.followUp && (
                          <div style={{ fontSize: 9, opacity: 0.5 }}>Follow-up: {o.followUp}</div>
                        )}
                        <div style={{ fontSize: 9, opacity: 0.5 }}>{o.studyDesign}</div>
                      </td>
                      <td>
                        <div>{o.noOfStudies} RCTs</div>
                        <div style={{ opacity: 0.6 }}>
                          {o.noOfParticipants.toLocaleString()} pts
                        </div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 10 }}>
                        {o.relativeEffect || '—'}
                      </td>
                      <td style={{ fontSize: 10 }}>{o.absoluteEffect || '—'}</td>
                      <td>
                        <Flexbox align={'center'} gap={4}>
                          <span style={{ color: cfg.color, fontSize: 14 }}>{cfg.emoji}</span>
                          <span style={{ color: cfg.color, fontSize: 11, fontWeight: 700 }}>
                            {cfg.label}
                          </span>
                          <Flexbox gap={2} horizontal>
                            {(
                              Object.entries(o.domains) as [
                                keyof GradeOutcome['domains'],
                                DomainRating,
                              ][]
                            ).map(([d, v]) =>
                              v !== 'no' && v !== 'not_assessed' ? (
                                <span
                                  key={d}
                                  style={{ color: '#faad14', fontSize: 8 }}
                                  title={`${DOMAIN_LABELS[d]}: ${v}`}
                                >
                                  ↓
                                </span>
                              ) : null,
                            )}
                          </Flexbox>
                        </Flexbox>
                      </td>
                      <td>
                        <Tag
                          color={
                            o.importance === 'critical'
                              ? 'red'
                              : o.importance === 'important'
                                ? 'orange'
                                : 'default'
                          }
                          style={{ fontSize: 9 }}
                        >
                          {o.importance}
                        </Tag>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <span style={{ fontSize: 10, opacity: 0.5 }}>
            ⊕⊕⊕⊕ High · ⊕⊕⊕⊝ Moderate · ⊕⊕⊝⊝ Low · ⊕⊝⊝⊝ Very low
          </span>
        </Flexbox>
      </div>

      <div style={{ borderTop: '1px solid', fontSize: 11, opacity: 0.5, paddingTop: 8 }}>
        📚 Reference: Guyatt GH, et al. GRADE: An emerging consensus on rating quality of evidence
        and strength of recommendations. <em>BMJ</em> 2008;336:924.
      </div>
    </Flexbox>
  );
});

GradeSoF.displayName = 'GradeSoF';
export default GradeSoF;
