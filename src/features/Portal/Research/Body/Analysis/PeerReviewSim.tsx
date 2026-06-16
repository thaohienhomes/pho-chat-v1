'use client';

/**
 * Peer Review Simulator
 *
 * Simulates the peer review process for a systematic review manuscript.
 * Users answer a structured set of questions about their manuscript,
 * and the tool provides editor/reviewer-style feedback with:
 *   - EQUATOR network criteria (PRISMA, CONSORT, STROBE)
 *   - Common reviewer objections with suggested responses
 *   - Reviewer persona simulation (Methodologist / Clinician / Statistician)
 *   - Readiness score + checklist summary
 */
import { Button, Tag } from '@lobehub/ui';
import { Select } from 'antd';
import { createStyles } from 'antd-style';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  RefreshCw,
  Send,
  Star,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

// ── Types ─────────────────────────────────────────────────────────────────────
type ReviewerType = 'clinician' | 'methodologist' | 'statistician';
type AnswerValue = 'no' | 'partial' | 'yes';

interface CheckItem {
  category: string;
  id: string;
  label: string;
  reviewerFocus: ReviewerType[];
  tip: string;
  weight: number; // 1-3 for scoring
}

interface ReviewFeedback {
  comment: string;
  persona: ReviewerType;
  severity: 'info' | 'major' | 'minor';
  suggestion: string;
}

// ── Checklist ─────────────────────────────────────────────────────────────────
const CHECKLIST: CheckItem[] = [
  // Protocol & Registration
  {
    category: 'Protocol',
    id: 'prospero',
    label: 'PROSPERO registration before data extraction started',
    reviewerFocus: ['methodologist', 'clinician'],
    tip: 'Mandatory for most high-impact journals. Register at prospero.york.ac.uk',
    weight: 3,
  },
  {
    category: 'Protocol',
    id: 'protocol_pub',
    label: 'Protocol published separately (e.g., Systematic Reviews BMC)',
    reviewerFocus: ['methodologist'],
    tip: 'Strengthens transparency and reduces reporting bias',
    weight: 2,
  },
  // Search
  {
    category: 'Search',
    id: 'databases',
    label: 'Searched ≥4 databases (PubMed, Embase, Cochrane, CINAHL/Scopus)',
    reviewerFocus: ['methodologist', 'clinician'],
    tip: 'Searching only PubMed misses 30-50% of eligible studies',
    weight: 3,
  },
  {
    category: 'Search',
    id: 'grey',
    label: 'Grey literature searched (WHO, clinical trial registries, conference abstracts)',
    reviewerFocus: ['methodologist'],
    tip: 'Publication bias is a major concern; grey literature mitigates it',
    weight: 2,
  },
  {
    category: 'Search',
    id: 'search_date',
    label: 'Search date and database versions/platform reported',
    reviewerFocus: ['methodologist'],
    tip: 'Required for reproducibility; cover within last 12 months for hot topics',
    weight: 2,
  },
  {
    category: 'Search',
    id: 'librarian',
    label: 'Search strategy peer-reviewed by information specialist/librarian',
    reviewerFocus: ['methodologist'],
    tip: 'PRESS checklist — methodologists increasingly require this',
    weight: 1,
  },
  // Screening
  {
    category: 'Screening',
    id: 'dual_screen',
    label: 'Dual independent screening (2 reviewers, kappa reported)',
    reviewerFocus: ['methodologist'],
    tip: 'Report Cohen κ ≥0.80 for title/abstract AND full-text',
    weight: 3,
  },
  {
    category: 'Screening',
    id: 'prisma',
    label: 'PRISMA 2020 flow diagram completed',
    reviewerFocus: ['methodologist', 'clinician'],
    tip: 'Updated 2020 version required; include previous SR screening if applicable',
    weight: 3,
  },
  // Data Extraction
  {
    category: 'Data Extraction',
    id: 'dual_extract',
    label: 'Dual independent data extraction with reconciliation',
    reviewerFocus: ['methodologist', 'statistician'],
    tip: 'At minimum, second reviewer verifies a random 20% sample',
    weight: 3,
  },
  {
    category: 'Data Extraction',
    id: 'form_reported',
    label: 'Data extraction form/template provided (appendix or supplement)',
    reviewerFocus: ['methodologist'],
    tip: 'Increasingly required; link to OSF or GitHub for open data',
    weight: 2,
  },
  // Risk of Bias
  {
    category: 'Risk of Bias',
    id: 'rob_tool',
    label: 'Appropriate RoB tool used (RoB 2 for RCT, ROBINS-I for NRS)',
    reviewerFocus: ['methodologist', 'clinician'],
    tip: 'Using Newcastle-Ottawa for RCTs is a common methodological error',
    weight: 3,
  },
  {
    category: 'Risk of Bias',
    id: 'rob_dual',
    label: 'RoB assessed independently by 2 reviewers',
    reviewerFocus: ['methodologist'],
    tip: 'Disagreements resolved by consensus or third reviewer',
    weight: 2,
  },
  // Statistics
  {
    category: 'Statistics',
    id: 'heterogeneity',
    label: 'Heterogeneity assessed (I², Cochran Q, τ²)',
    reviewerFocus: ['statistician'],
    tip: 'I² alone is insufficient; report τ² and prediction interval',
    weight: 3,
  },
  {
    category: 'Statistics',
    id: 'meta_model',
    label: 'Justification for fixed vs random-effects model',
    reviewerFocus: ['statistician'],
    tip: 'With >3 studies, random-effects is generally preferred',
    weight: 2,
  },
  {
    category: 'Statistics',
    id: 'subgroup',
    label: 'Pre-specified subgroup analyses reported (not post-hoc)',
    reviewerFocus: ['statistician'],
    tip: 'Post-hoc subgroups without PROSPERO registration are highly criticized',
    weight: 2,
  },
  {
    category: 'Statistics',
    id: 'pub_bias',
    label: 'Publication bias assessed (Egger/Begg test, funnel plot) when ≥10 studies',
    reviewerFocus: ['statistician'],
    tip: 'Trim-and-fill if funnel asymmetry detected',
    weight: 2,
  },
  // Quality of Evidence
  {
    category: 'GRADE',
    id: 'grade',
    label: 'GRADE certainty of evidence reported for each outcome',
    reviewerFocus: ['methodologist', 'clinician'],
    tip: 'Summary of findings (SoF) table strongly recommended',
    weight: 3,
  },
  // Writing
  {
    category: 'Writing',
    id: 'abstract_structured',
    label: 'Structured abstract follows target journal format',
    reviewerFocus: ['clinician'],
    tip: 'Background/Methods/Results/Conclusions for most medical journals',
    weight: 1,
  },
  {
    category: 'Writing',
    id: 'clinical_implications',
    label: 'Clinical implications clearly stated with actionable recommendations',
    reviewerFocus: ['clinician'],
    tip: 'Clinician reviewers reject papers that fail to answer "so what for patients?"',
    weight: 2,
  },
  {
    category: 'Writing',
    id: 'limitations',
    label: 'Limitations acknowledged (heterogeneity, publication bias, language bias)',
    reviewerFocus: ['clinician', 'methodologist'],
    tip: 'Do not minimize limitations — reviewers will penalize evasiveness',
    weight: 2,
  },
];

const CATEGORIES = [...new Set(CHECKLIST.map((c) => c.category))];

// ── Feedback generator ────────────────────────────────────────────────────────
const REVIEWER_PERSONAS: Record<ReviewerType, string> = {
  clinician: '👨‍⚕️ Reviewer 1 (Clinical Physician)',
  methodologist: '🔬 Reviewer 2 (SR Methodologist)',
  statistician: '📊 Reviewer 3 (Biostatistician)',
};

const generateFeedback = (
  answers: Record<string, AnswerValue>,
  persona: ReviewerType,
): ReviewFeedback[] => {
  const relevant = CHECKLIST.filter((c) => c.reviewerFocus.includes(persona));
  const feedback: ReviewFeedback[] = [];

  for (const item of relevant) {
    const ans = answers[item.id] ?? 'no';
    if (ans === 'yes') continue;

    const severity =
      ans === 'partial'
        ? item.weight >= 3
          ? 'major'
          : 'minor'
        : item.weight >= 3
          ? 'major'
          : item.weight === 2
            ? 'minor'
            : 'info';

    const comments: Record<ReviewerType, Record<string, string>> = {
      clinician: {
        clinical_implications:
          'The clinical implications section lacks specificity. Please add explicit recommendations for clinicians and policy makers.',
        databases:
          'The literature search appears incomplete. Only searching PubMed misses a substantial proportion of eligible studies.',
        grade:
          'Without GRADE certainty ratings, clinicians cannot judge how confidently they should apply these findings in practice.',
        prisma:
          'The PRISMA flow diagram is missing or incomplete. This is required for transparency of study selection.',
      },
      methodologist: {
        databases:
          'The search strategy is not comprehensive. A minimum of 4 electronic databases must be searched with full search strings documented.',
        dual_screen:
          'Independent dual screening is not described. Without inter-rater reliability statistics (Cohen κ), the selection process cannot be evaluated.',
        prospero:
          'No PROSPERO registration is reported. Prospective registration is mandatory for high-quality systematic reviews and required by most journals.',
        rob_tool:
          'The risk of bias tool is not appropriate for the included study designs. RoB 2 should be used for RCTs; ROBINS-I for non-randomized studies.',
      },
      statistician: {
        heterogeneity:
          'Heterogeneity quantification is insufficient. Report I², Cochran Q statistic, τ², and a 95% prediction interval.',
        meta_model:
          'The choice of meta-analytic model is not justified. With clinical/methodological heterogeneity expected, random-effects is preferred.',
        pub_bias:
          "Publication bias assessment is missing. With ≥10 studies, Egger's test and funnel plot symmetry assessment are required.",
        subgroup:
          'Subgroup analyses were not pre-specified in the protocol. Post-hoc subgroup analyses require explicit labeling and cautious interpretation.',
      },
    };

    const comment =
      (comments[persona] as Record<string, string>)[item.id] ??
      `${item.label} ${ans === 'partial' ? 'is only partially addressed' : 'has not been addressed'}. ${item.tip}`;

    feedback.push({ comment, persona, severity, suggestion: item.tip });
  }

  // Sort: major first
  return feedback.sort((a, b) => {
    const order = { info: 2, major: 0, minor: 1 };
    return order[a.severity] - order[b.severity];
  });
};

// ── Styles ────────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  checkRow: css`
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;

    padding-block: 7px;
    padding-inline: 0;
    border-block-end: 1px solid ${token.colorBorder};

    &:last-child {
      border-block-end: none;
    }
  `,
  container: css`
    width: 100%;
  `,
  feedCard: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-inline-start: 3px solid;
    border-radius: ${token.borderRadius}px;
  `,
  scoreCircle: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    width: 80px;
    height: 80px;
    border-radius: 50%;

    font-size: 22px;
    font-weight: 900;
  `,
}));

const SEVERITY_COLORS = { info: '#1890ff', major: '#ff4d4f', minor: '#faad14' };
const SEVERITY_BG = {
  info: 'rgba(24,144,255,0.06)',
  major: 'rgba(255,77,79,0.06)',
  minor: 'rgba(250,173,20,0.06)',
};

const PowerIcon = ({ score }: { score: number }) => {
  const color = score >= 80 ? '#52c41a' : score >= 60 ? '#faad14' : '#ff4d4f';
  const label = score >= 80 ? 'STRONG' : score >= 60 ? 'MODERATE' : 'WEAK';
  return (
    <div
      style={{
        alignItems: 'center',
        background: `${color}22`,
        border: `3px solid ${color}`,
        borderRadius: '50%',
        display: 'flex',
        flexDirection: 'column',
        height: 90,
        justifyContent: 'center',
        width: 90,
      }}
    >
      <span style={{ color, fontSize: 26, fontWeight: 900 }}>{score}</span>
      <span style={{ color, fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>{label}</span>
    </div>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────
const PeerReviewSim = memo(() => {
  const { styles } = useStyles();
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [persona, setPersona] = useState<ReviewerType>('methodologist');
  const [submitted, setSubmitted] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(CATEGORIES));

  const setAnswer = useCallback((id: string, val: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [id]: val }));
    setSubmitted(false);
  }, []);

  const toggleCat = useCallback((cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const score = useMemo(() => {
    let earned = 0,
      total = 0;
    for (const item of CHECKLIST) {
      total += item.weight * 2;
      const a = answers[item.id] ?? 'no';
      if (a === 'yes') earned += item.weight * 2;
      else if (a === 'partial') earned += item.weight;
    }
    return Math.round((earned / total) * 100);
  }, [answers]);

  const feedback = useMemo(
    () => (submitted ? generateFeedback(answers, persona) : []),
    [submitted, answers, persona],
  );
  const majors = feedback.filter((f) => f.severity === 'major').length;
  const minors = feedback.filter((f) => f.severity === 'minor').length;

  const reset = useCallback(() => {
    setAnswers({});
    setSubmitted(false);
  }, []);

  const answered = Object.keys(answers).length;
  const total = CHECKLIST.length;

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>🎭 Peer Review Simulator</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Pre-submission checklist from 3 reviewer perspectives — PRISMA, GRADE, EQUATOR criteria
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal>
          <Select
            onChange={(v: ReviewerType) => setPersona(v)}
            options={Object.entries(REVIEWER_PERSONAS).map(([k, v]) => ({ label: v, value: k }))}
            size="small"
            value={persona}
          />
          <button
            onClick={reset}
            style={{
              alignItems: 'center',
              background: 'transparent',
              border: '1px solid',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              fontSize: 12,
              gap: 4,
              padding: '4px 10px',
            }}
            type="button"
          >
            <RefreshCw size={11} /> Reset
          </button>
        </Flexbox>
      </Flexbox>

      {/* Progress + score */}
      <div className={styles.card}>
        <Flexbox align={'center'} gap={16} horizontal justify={'space-between'} wrap={'wrap'}>
          <PowerIcon score={score} />
          <Flexbox gap={8} style={{ flex: 1 }}>
            <Flexbox gap={4} horizontal wrap={'wrap'}>
              <Tag color="blue">
                {answered}/{total} answered
              </Tag>
              <Tag color={score >= 80 ? 'green' : score >= 60 ? 'gold' : 'red'}>
                Readiness: {score}%
              </Tag>
              {submitted && (
                <>
                  {majors > 0 && <Tag color="red">⚠️ {majors} major issues</Tag>}
                  {minors > 0 && <Tag color="orange">{minors} minor issues</Tag>}
                  {majors === 0 && minors === 0 && <Tag color="green">✅ No critical issues</Tag>}
                </>
              )}
            </Flexbox>
            {/* Score bar */}
            <div
              style={{
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 4,
                height: 8,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: score >= 80 ? '#52c41a' : score >= 60 ? '#faad14' : '#ff4d4f',
                  borderRadius: 4,
                  height: '100%',
                  transition: 'width 0.4s',
                  width: `${score}%`,
                }}
              />
            </div>
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              {score < 60
                ? '🔴 Major revisions expected — address critical items first'
                : score < 80
                  ? '🟡 Minor revisions likely — strengthen methodology reporting'
                  : '🟢 Well-prepared — ready for submission to high-impact journals'}
            </span>
          </Flexbox>
          <Button icon={<Send size={13} />} onClick={() => setSubmitted(true)} type={'primary'}>
            Simulate Review
          </Button>
        </Flexbox>
      </div>

      {/* Checklist by category */}
      {CATEGORIES.map((cat) => {
        const items = CHECKLIST.filter((c) => c.category === cat);
        const catAnswered = items.filter((c) => answers[c.id]).length;
        const expanded = expandedCats.has(cat);
        return (
          <div className={styles.card} key={cat}>
            <button
              onClick={() => toggleCat(cat)}
              style={{
                alignItems: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                gap: 8,
                justifyContent: 'space-between',
                padding: 0,
                width: '100%',
              }}
              type="button"
            >
              <Flexbox align={'center'} gap={8}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{cat}</span>
                <Tag style={{ fontSize: 10 }}>
                  {catAnswered}/{items.length}
                </Tag>
                {items.some((c) => answers[c.id] === 'no' && c.weight >= 3) && (
                  <Tag color="red" style={{ fontSize: 10 }}>
                    ⚠️ critical gap
                  </Tag>
                )}
              </Flexbox>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {expanded &&
              items.map((item) => {
                const ans = answers[item.id] ?? null;
                return (
                  <div className={styles.checkRow} key={item.id}>
                    <Flexbox gap={2}>
                      <Flexbox align={'center'} gap={4} horizontal>
                        {item.weight === 3 && (
                          <span style={{ color: '#ff4d4f', fontSize: 10 }} title="Critical item">
                            ★★★
                          </span>
                        )}
                        {item.weight === 2 && (
                          <span style={{ color: '#faad14', fontSize: 10 }} title="Important">
                            ★★
                          </span>
                        )}
                        {item.weight === 1 && (
                          <span style={{ color: '#52c41a', fontSize: 10 }} title="Nice to have">
                            ★
                          </span>
                        )}
                        <span style={{ fontSize: 12 }}>{item.label}</span>
                      </Flexbox>
                      {ans === null && (
                        <span style={{ fontSize: 10, opacity: 0.4 }}>{item.tip}</span>
                      )}
                    </Flexbox>
                    <Flexbox gap={4} horizontal>
                      {(['yes', 'partial', 'no'] as AnswerValue[]).map((val) => (
                        <button
                          key={val}
                          onClick={() => setAnswer(item.id, val)}
                          style={{
                            background:
                              ans === val
                                ? val === 'yes'
                                  ? 'rgba(82,196,26,0.15)'
                                  : val === 'partial'
                                    ? 'rgba(250,173,20,0.15)'
                                    : 'rgba(255,77,79,0.15)'
                                : 'transparent',
                            border: '1px solid',
                            borderColor:
                              ans === val
                                ? val === 'yes'
                                  ? '#52c41a'
                                  : val === 'partial'
                                    ? '#faad14'
                                    : '#ff4d4f'
                                : 'rgba(128,128,128,0.3)',
                            borderRadius: 4,
                            color:
                              ans === val
                                ? val === 'yes'
                                  ? '#52c41a'
                                  : val === 'partial'
                                    ? '#faad14'
                                    : '#ff4d4f'
                                : 'inherit',
                            cursor: 'pointer',
                            fontSize: 10,
                            fontWeight: ans === val ? 700 : 400,
                            padding: '2px 7px',
                          }}
                          type="button"
                        >
                          {val === 'yes' ? '✓ Yes' : val === 'partial' ? '~ Partial' : '✗ No'}
                        </button>
                      ))}
                    </Flexbox>
                  </div>
                );
              })}
          </div>
        );
      })}

      {/* Feedback */}
      {submitted && feedback.length > 0 && (
        <Flexbox gap={8}>
          <Flexbox align={'center'} gap={6} horizontal>
            <MessageSquare size={14} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {REVIEWER_PERSONAS[persona]} — Review Comments
            </span>
            <Tag color="red">{majors} major</Tag>
            <Tag color="orange">{minors} minor</Tag>
          </Flexbox>
          {feedback.map((f, i) => (
            <div
              className={styles.feedCard}
              key={i}
              style={{
                background: SEVERITY_BG[f.severity],
                borderColor: SEVERITY_COLORS[f.severity],
              }}
            >
              <Flexbox gap={4}>
                <Flexbox align={'center'} gap={6} horizontal>
                  {f.severity === 'major' ? (
                    <AlertCircle size={13} style={{ color: '#ff4d4f' }} />
                  ) : f.severity === 'minor' ? (
                    <Star size={13} style={{ color: '#faad14' }} />
                  ) : (
                    <CheckCircle size={13} style={{ color: '#1890ff' }} />
                  )}
                  <Tag
                    color={
                      f.severity === 'major' ? 'red' : f.severity === 'minor' ? 'orange' : 'blue'
                    }
                    style={{ fontSize: 10 }}
                  >
                    {f.severity.toUpperCase()}
                  </Tag>
                </Flexbox>
                <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>{f.comment}</p>
                {f.severity !== 'info' && (
                  <p style={{ fontSize: 11, fontStyle: 'italic', margin: 0, opacity: 0.6 }}>
                    💡 <strong>Suggestion:</strong> {f.suggestion}
                  </p>
                )}
              </Flexbox>
            </div>
          ))}
        </Flexbox>
      )}

      {submitted && feedback.length === 0 && (
        <div
          style={{
            background: 'rgba(82,196,26,0.08)',
            border: '1px solid rgba(82,196,26,0.3)',
            borderRadius: 8,
            padding: 16,
            textAlign: 'center',
          }}
        >
          <CheckCircle size={24} style={{ color: '#52c41a' }} />
          <p style={{ color: '#52c41a', fontSize: 13, margin: '8px 0 0' }}>
            ✅ No critical issues from {REVIEWER_PERSONAS[persona]}. Your manuscript appears
            well-prepared!
          </p>
        </div>
      )}
    </Flexbox>
  );
});

PeerReviewSim.displayName = 'PeerReviewSim';
export default PeerReviewSim;
