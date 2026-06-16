'use client';

/**
 * CONSORT / STROBE Checklist
 *
 * CONSORT 2010 — 25-item checklist for Randomized Controlled Trials
 * STROBE 2007  — 22-item checklist for Observational Studies (Cohort/Case-Control/Cross-Sectional)
 *
 * Each item: checkbox + free-text location (page/section in manuscript)
 * Summary: % completed, export as Markdown table
 */
import { Tag } from '@lobehub/ui';
import { Progress, Select, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { CheckCircle, Circle, Copy } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

// ── CONSORT 2010 items ────────────────────────────────────────────────────────
const CONSORT_ITEMS = [
  // Title & Abstract
  { id: 'c1a', label: 'Identification as RCT in title', note: '(1a)', section: 'Title & Abstract' },
  {
    id: 'c1b',
    label: 'Structured summary of trial design, methods, results, conclusions',
    note: '(1b)',
    section: 'Title & Abstract',
  },
  // Introduction
  {
    id: 'c2a',
    label: 'Scientific background and rationale',
    note: '(2a)',
    section: 'Introduction',
  },
  { id: 'c2b', label: 'Specific objectives or hypotheses', note: '(2b)', section: 'Introduction' },
  // Methods
  {
    id: 'c3a',
    label: 'Description of trial design — allocation ratio',
    note: '(3a)',
    section: 'Methods: Design',
  },
  {
    id: 'c3b',
    label: 'Important changes to methods after commencement (reasons)',
    note: '(3b)',
    section: 'Methods: Design',
  },
  {
    id: 'c4a',
    label: 'Eligibility criteria for participants',
    note: '(4a)',
    section: 'Methods: Participants',
  },
  {
    id: 'c4b',
    label: 'Settings and locations where data were collected',
    note: '(4b)',
    section: 'Methods: Participants',
  },
  {
    id: 'c5',
    label: 'Interventions — sufficient detail to allow replication',
    note: '(5)',
    section: 'Methods: Interventions',
  },
  {
    id: 'c6a',
    label: 'Pre-specified primary and secondary outcome measures',
    note: '(6a)',
    section: 'Methods: Outcomes',
  },
  {
    id: 'c6b',
    label: 'Any changes to outcomes after trial commencement',
    note: '(6b)',
    section: 'Methods: Outcomes',
  },
  {
    id: 'c7a',
    label: 'How sample size was determined',
    note: '(7a)',
    section: 'Methods: Sample Size',
  },
  {
    id: 'c7b',
    label: 'Interim analyses and stopping rules',
    note: '(7b)',
    section: 'Methods: Sample Size',
  },
  {
    id: 'c8a',
    label: 'Method used to generate random allocation sequence',
    note: '(8a)',
    section: 'Methods: Randomization',
  },
  {
    id: 'c8b',
    label: 'Type of randomization; restriction details',
    note: '(8b)',
    section: 'Methods: Randomization',
  },
  {
    id: 'c9',
    label: 'Allocation concealment mechanism',
    note: '(9)',
    section: 'Methods: Randomization',
  },
  {
    id: 'c10',
    label: 'Who generated sequence. Who enrolled participants. Who assigned',
    note: '(10)',
    section: 'Methods: Randomization',
  },
  {
    id: 'c11a',
    label: 'Blinding — who was blinded after assignment',
    note: '(11a)',
    section: 'Methods: Blinding',
  },
  {
    id: 'c11b',
    label: 'Similarity of interventions if relevant',
    note: '(11b)',
    section: 'Methods: Blinding',
  },
  {
    id: 'c12a',
    label: 'Statistical methods for primary and secondary outcomes',
    note: '(12a)',
    section: 'Methods: Statistics',
  },
  {
    id: 'c12b',
    label: 'Methods for additional analyses e.g. subgroup analyses',
    note: '(12b)',
    section: 'Methods: Statistics',
  },
  // Results
  {
    id: 'c13a',
    label: 'Participant flow (CONSORT diagram)',
    note: '(13a)',
    section: 'Results: Participant Flow',
  },
  {
    id: 'c13b',
    label: 'Losses and exclusions after randomization with reasons',
    note: '(13b)',
    section: 'Results: Participant Flow',
  },
  {
    id: 'c14a',
    label: 'Dates when defining period of enrolment and follow-up',
    note: '(14a)',
    section: 'Results: Recruitment',
  },
  { id: 'c14b', label: 'Trial stopped — why', note: '(14b)', section: 'Results: Recruitment' },
  {
    id: 'c15',
    label: 'Table of baseline demographics for each group',
    note: '(15)',
    section: 'Results: Baseline',
  },
  {
    id: 'c16',
    label: 'Numbers analysed in each group (ITT, PP)',
    note: '(16)',
    section: 'Results: Numbers Analysed',
  },
  {
    id: 'c17a',
    label: 'Results for primary and secondary outcomes — effect size + 95% CI',
    note: '(17a)',
    section: 'Results: Outcomes',
  },
  {
    id: 'c17b',
    label: 'Binary outcomes — recommend absolute and relative effect sizes',
    note: '(17b)',
    section: 'Results: Outcomes',
  },
  {
    id: 'c18',
    label: 'Results of any other analyses performed (subgroup)',
    note: '(18)',
    section: 'Results: Ancillary',
  },
  {
    id: 'c19',
    label: 'Adverse events or unintended effects in each group',
    note: '(19)',
    section: 'Results: Harms',
  },
  // Discussion
  {
    id: 'c20',
    label: 'Trial limitations: imprecision, bias, multiplicity, generalizability',
    note: '(20)',
    section: 'Discussion: Limitations',
  },
  {
    id: 'c21',
    label: 'Generalizability (external validity, applicability)',
    note: '(21)',
    section: 'Discussion: Generalizability',
  },
  {
    id: 'c22',
    label: 'Interpretation consistent with results, balancing benefits and harms',
    note: '(22)',
    section: 'Discussion: Interpretation',
  },
  // Other
  {
    id: 'c23',
    label: 'Registration number and registry name',
    note: '(23)',
    section: 'Other: Registration',
  },
  { id: 'c24', label: 'Original protocol accessible', note: '(24)', section: 'Other: Protocol' },
  {
    id: 'c25',
    label: 'Funding and other support, role of funders',
    note: '(25)',
    section: 'Other: Funding',
  },
];

// ── STROBE 2007 items (cohort version) ───────────────────────────────────────
const STROBE_ITEMS = [
  {
    id: 's1a',
    label: 'Study design in title or abstract',
    note: '(1a)',
    section: 'Title & Abstract',
  },
  { id: 's1b', label: 'Informative, balanced abstract', note: '(1b)', section: 'Title & Abstract' },
  { id: 's2', label: 'Scientific background and rationale', note: '(2)', section: 'Introduction' },
  {
    id: 's3',
    label: 'Objectives, including pre-specified hypotheses',
    note: '(3)',
    section: 'Introduction',
  },
  {
    id: 's4',
    label: 'Study design presented early in paper',
    note: '(4)',
    section: 'Methods: Design',
  },
  {
    id: 's5',
    label: 'Setting, locations, relevant dates (period of recruitment, exposure, follow-up)',
    note: '(5)',
    section: 'Methods: Setting',
  },
  {
    id: 's6a',
    label: 'Participants — eligibility criteria, sources, selection methods',
    note: '(6a)',
    section: 'Methods: Participants',
  },
  {
    id: 's6b',
    label: 'Cohort/case-control: methods of follow-up or matching',
    note: '(6b)',
    section: 'Methods: Participants',
  },
  {
    id: 's7',
    label: 'Clearly define all outcomes, exposures, predictors, confounders',
    note: '(7)',
    section: 'Methods: Variables',
  },
  {
    id: 's8',
    label: 'Data sources, measurement, and assessment methods',
    note: '(8)',
    section: 'Methods: Data Sources',
  },
  {
    id: 's9',
    label: 'Any efforts to address potential sources of bias',
    note: '(9)',
    section: 'Methods: Bias',
  },
  {
    id: 's10',
    label: 'How study size was arrived at',
    note: '(10)',
    section: 'Methods: Study Size',
  },
  {
    id: 's11',
    label: 'Quantitative variables — groupings, comparisons',
    note: '(11)',
    section: 'Methods: Quantitative Variables',
  },
  {
    id: 's12a',
    label: 'All statistical methods including confounding control',
    note: '(12a)',
    section: 'Methods: Statistical Methods',
  },
  {
    id: 's12b',
    label: 'Methods for subgroup and sensitivity analyses',
    note: '(12b)',
    section: 'Methods: Statistical Methods',
  },
  {
    id: 's13a',
    label: 'Numbers at each stage — flow diagram',
    note: '(13a)',
    section: 'Results: Participants',
  },
  {
    id: 's13b',
    label: 'Non-participants reasons, follow-up losses',
    note: '(13b)',
    section: 'Results: Participants',
  },
  {
    id: 's14',
    label: 'Baseline characteristics',
    note: '(14)',
    section: 'Results: Descriptive Data',
  },
  {
    id: 's15',
    label: 'Outcome events or summary measures',
    note: '(15)',
    section: 'Results: Outcome Data',
  },
  {
    id: 's16',
    label: 'Main results — unadjusted & adjusted estimates + CI',
    note: '(16)',
    section: 'Results: Main Results',
  },
  {
    id: 's17',
    label: 'Reporting of other analyses — subgroups, interactions',
    note: '(17)',
    section: 'Results: Other Analyses',
  },
  {
    id: 's18',
    label: 'Key results with reference to study objectives',
    note: '(18)',
    section: 'Discussion: Key Results',
  },
  {
    id: 's19',
    label: 'Limitations — sources of bias, imprecision',
    note: '(19)',
    section: 'Discussion: Limitations',
  },
  {
    id: 's20',
    label: 'Generalizability / external validity',
    note: '(20)',
    section: 'Discussion: Generalizability',
  },
  {
    id: 's21',
    label: 'Interpretation balancing evidence, and caution for alternative explanations',
    note: '(21)',
    section: 'Discussion: Interpretation',
  },
  {
    id: 's22',
    label: 'Source of funding and conflicts of interest',
    note: '(22)',
    section: 'Other: Funding',
  },
];

type ChecklistType = 'consort' | 'strobe';

// ── Styles ────────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  checkRow: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 24px 1fr 140px;
    gap: 10px;
    align-items: start;

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
  container: css`
    width: 100%;
  `,
  locationInput: css`
    width: 100%;
    padding-block: 2px;
    padding-inline: 6px;
    border: 1px solid ${token.colorBorder};
    border-radius: 4px;

    font-size: 11px;
    color: ${token.colorText};

    background: ${token.colorBgContainer};

    &:focus {
      outline: 2px solid ${token.colorPrimary};
    }
  `,
  sectionHeader: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    padding-block: 6px;
    padding-inline: 12px;
    border-block-start: 1px solid ${token.colorBorderSecondary};
    border-block-end: 1px solid ${token.colorBorderSecondary};

    font-size: 10px;
    font-weight: 700;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;

    background: ${token.colorFillQuaternary};
  `,
  statsBar: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: ${token.borderRadiusLG}px;

    background: linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorFillQuaternary});
  `,
  table: css`
    overflow-y: auto;
    max-height: 500px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
  `,
}));

const ConsortStrobe = memo(() => {
  const { styles } = useStyles();
  const [type, setType] = useState<ChecklistType>('consort');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [location, setLocation] = useState<Record<string, string>>({});

  const items = type === 'consort' ? CONSORT_ITEMS : STROBE_ITEMS;

  // Group by section
  const sections = useMemo(() => {
    const groups: Record<string, typeof items> = {};
    for (const item of items) {
      if (!groups[item.section]) groups[item.section] = [];
      groups[item.section].push(item);
    }
    return Object.entries(groups);
  }, [items]);

  const completedCount = useMemo(() => items.filter((i) => checked[i.id]).length, [items, checked]);

  const pct = Math.round((completedCount / items.length) * 100);

  const toggleItem = useCallback((id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const selectAll = useCallback(() => {
    const all: Record<string, boolean> = {};
    for (const item of items) all[item.id] = true;
    setChecked(all);
  }, [items]);

  const clearAll = useCallback(() => {
    setChecked({});
    setLocation({});
  }, []);

  const exportMarkdown = useCallback(() => {
    const name = type === 'consort' ? 'CONSORT 2010' : 'STROBE 2007';
    const header = `# ${name} Checklist\n\n| # | Item | Reported | Location |\n|---|---|---|---|`;
    const rows = items.map(
      (item, i) =>
        `| ${i + 1} | **${item.section}**: ${item.label} ${item.note} | ${checked[item.id] ? '✅ Yes' : '❌ No'} | ${location[item.id] || '—'} |`,
    );
    const summary = `\n\n**Completion: ${completedCount}/${items.length} (${pct}%)**`;
    navigator.clipboard.writeText([header, ...rows, summary].join('\n'));
  }, [type, items, checked, location, completedCount, pct]);

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📋 Reporting Checklist</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Verify your manuscript meets reporting standards before submission
          </span>
        </Flexbox>
        <Flexbox align={'center'} gap={8} horizontal>
          <Select
            onChange={(v) => {
              setType(v);
              setChecked({});
              setLocation({});
            }}
            options={[
              { label: '🔬 CONSORT 2010 (RCT — 37 items)', value: 'consort' },
              { label: '👁️ STROBE 2007 (Observational — 26 items)', value: 'strobe' },
            ]}
            size="small"
            value={type}
          />
        </Flexbox>
      </Flexbox>

      {/* Progress bar */}
      <div className={styles.statsBar}>
        <Flexbox gap={6}>
          <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {type.toUpperCase()} Completion: {completedCount}/{items.length}
            </span>
            <Flexbox gap={6} horizontal>
              <Tag
                color={pct === 100 ? 'green' : pct >= 80 ? 'blue' : pct >= 50 ? 'orange' : 'red'}
              >
                {pct}%
              </Tag>
              {pct === 100 && <Tag color="green">✅ Ready to submit</Tag>}
            </Flexbox>
          </Flexbox>
          <Progress
            percent={pct}
            showInfo={false}
            status={pct === 100 ? 'success' : 'active'}
            strokeColor={pct === 100 ? '#52c41a' : pct >= 80 ? '#1890ff' : '#faad14'}
          />
          <Flexbox gap={6} horizontal>
            <button
              onClick={selectAll}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 4,
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 11,
                padding: '2px 8px',
              }}
              type="button"
            >
              Check All
            </button>
            <button
              onClick={clearAll}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 4,
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 11,
                padding: '2px 8px',
              }}
              type="button"
            >
              Clear All
            </button>
            <button
              onClick={exportMarkdown}
              style={{
                alignItems: 'center',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 4,
                color: 'inherit',
                cursor: 'pointer',
                display: 'flex',
                fontSize: 11,
                gap: 4,
                marginLeft: 'auto',
                padding: '2px 8px',
              }}
              type="button"
            >
              <Copy size={10} /> Copy Markdown Table
            </button>
          </Flexbox>
        </Flexbox>
      </div>

      {/* Checklist table */}
      <div className={styles.table}>
        {/* Column header */}
        <div
          style={{
            borderBottom: '2px solid',
            display: 'grid',
            fontSize: 10,
            fontWeight: 700,
            gap: 10,
            gridTemplateColumns: '24px 1fr 140px',
            opacity: 0.6,
            padding: '6px 12px',
            textTransform: 'uppercase',
          }}
        >
          <span>✓</span>
          <span>Item</span>
          <span>Location in manuscript</span>
        </div>

        {sections.map(([sectionName, sItems]) => (
          <div key={sectionName}>
            <div className={styles.sectionHeader}>{sectionName}</div>
            {sItems.map((item) => (
              <div className={styles.checkRow} key={item.id} onClick={() => toggleItem(item.id)}>
                {/* Checkbox */}
                <div style={{ paddingTop: 1 }}>
                  {checked[item.id] ? (
                    <CheckCircle size={16} style={{ color: '#52c41a' }} />
                  ) : (
                    <Circle size={16} style={{ opacity: 0.3 }} />
                  )}
                </div>

                {/* Label */}
                <Flexbox gap={2}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: checked[item.id] ? 400 : 600,
                      opacity: checked[item.id] ? 0.5 : 1,
                      textDecoration: checked[item.id] ? 'line-through' : 'none',
                    }}
                  >
                    {item.label}
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.4 }}>{item.note}</span>
                </Flexbox>

                {/* Location input */}
                <div onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Enter page number or section (e.g. 'p.3 Methods')">
                    <input
                      className={styles.locationInput}
                      onChange={(e) =>
                        setLocation((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder="p.# / Section"
                      value={location[item.id] || ''}
                    />
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer note */}
      <div style={{ fontSize: 11, opacity: 0.5 }}>
        💡 <strong>Tip:</strong> Most journals require a completed {type.toUpperCase()} checklist
        submitted alongside your manuscript.
        {type === 'consort' && ' CONSORT: '}
        {type === 'strobe' && ' STROBE: '}
        <a
          href={
            type === 'consort'
              ? 'https://www.consort-statement.org'
              : 'https://www.strobe-statement.org'
          }
          rel="noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}
          target="_blank"
        >
          {type === 'consort' ? 'consort-statement.org' : 'strobe-statement.org'}
        </a>
      </div>
    </Flexbox>
  );
});

ConsortStrobe.displayName = 'ConsortStrobe';
export default ConsortStrobe;
