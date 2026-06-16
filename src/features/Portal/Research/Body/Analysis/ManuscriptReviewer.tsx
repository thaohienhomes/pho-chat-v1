'use client';

/**
 * Multi-Agent Manuscript Reviewer
 *
 * Inspired by claesbackman/AI-research-feedback — adapts the 6-agent
 * parallel review approach for medical/health research papers.
 *
 * Runs 6 specialized AI review agents in parallel, each examining
 * the paper from a different perspective:
 *   1. Language & Academic Style
 *   2. Internal Consistency & Cross-references
 *   3. Claims & Identification Integrity
 *   4. Statistical Methods & Notation
 *   5. Tables, Figures & CONSORT/STROBE Compliance
 *   6. Adversarial Referee (journal-specific persona)
 *
 * Results are consolidated into a single structured Pre-Submission Report.
 */
import { Button, Tag } from '@lobehub/ui';
import { Collapse, Select } from 'antd';
import { createStyles } from 'antd-style';
import {
  AlertTriangle,
  Bot,
  CheckCircle,
  ClipboardCopy,
  Download,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useResearchStore } from '@/store/research';

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
  output: css`
    overflow-x: auto;

    max-height: 500px;
    padding: 14px;
    border-radius: 8px;

    font-family: 'Fira Code', monospace;
    font-size: 11px;
    line-height: 1.5;
    color: #d4d4d4;
    white-space: pre-wrap;

    background: #0a0a0a;
  `,
}));

// ── Agent definitions ─────────────────────────────────────────────────────────
interface AgentDef {
  color: string;
  description: string;
  icon: string;
  id: string;
  name: string;
  promptBuilder: (ctx: ReviewCtx) => string;
}

interface ReviewCtx {
  abstracts: string;
  journal: string;
  paperCount: number;
  researchQuestion: string;
}

type AgentStatus = 'done' | 'error' | 'idle' | 'running';

interface AgentResult {
  output: string;
  status: AgentStatus;
}

const JOURNALS = [
  { label: '🏆 Leading Medical Journal (generic)', value: 'top-medical' },
  { label: 'The Lancet', value: 'Lancet' },
  { label: 'NEJM', value: 'NEJM' },
  { label: 'BMJ', value: 'BMJ' },
  { label: 'JAMA', value: 'JAMA' },
  { label: 'Nature Medicine', value: 'Nature Medicine' },
  { label: 'PLOS ONE', value: 'PLOS ONE' },
  { label: 'Cochrane Database', value: 'Cochrane' },
  { label: 'Annals of Internal Medicine', value: 'Annals Intern Med' },
  { label: 'Circulation', value: 'Circulation' },
  { label: 'Journal of Clinical Oncology', value: 'JCO' },
];

const AGENTS: AgentDef[] = [
  {
    color: '#1890ff',
    description: 'Spelling, grammar, hedging, academic style violations',
    icon: '✍️',
    id: 'style',
    name: 'Language & Academic Style',
    promptBuilder: (
      ctx,
    ) => `You are a copy editor at a top medical journal. Review the following research paper abstracts for:

1. **Spelling errors** in medical/scientific terms
2. **Grammar**: tense consistency, subject-verb agreement, article usage
3. **Awkward phrasing** requiring re-reading
4. **Style violations**: "interestingly", "importantly", "it is worth noting" (delete these); passive voice where active is better; "significant" used non-statistically
5. **Hedging**: overconfident claims or excessive hedging
6. **Number formatting**: consistency in percentages, p-values, confidence intervals

Research question: ${ctx.researchQuestion}
${ctx.abstracts}

Output format:
## Agent 1: Language & Academic Style
### Critical Issues (must fix)
[numbered list with location, problematic text, suggested correction, reason]
### Minor Issues
[same format]
### Style Patterns to Fix
[recurring patterns with examples]`,
  },
  {
    color: '#52c41a',
    description: 'Numerical consistency, cross-references, terminology drift',
    icon: '🔗',
    id: 'consistency',
    name: 'Internal Consistency',
    promptBuilder: (
      ctx,
    ) => `You are a technical reviewer checking internal coherence of a systematic review with ${ctx.paperCount} included studies.

Check:
1. **Numerical consistency**: Do reported numbers match across abstract, results, tables?
2. **Abstract vs body**: Do findings claimed in abstract match the evidence?
3. **Terminology consistency**: Are key terms used consistently throughout?
4. **Sample description**: Is sample size consistent across sections?
5. **Statistical reporting**: Are p-values, CIs, effect sizes reported consistently?
6. **Citation accuracy**: Do in-text citations match reference list?

Research: ${ctx.researchQuestion}
${ctx.abstracts}

Output format:
## Agent 2: Internal Consistency
### Critical Inconsistencies
[Location 1 ↔ Location 2 | What conflicts | Severity: CRITICAL]
### Terminology Drift
[Term | How it varies | Recommended standardization]
### Minor Inconsistencies
[same format]`,
  },
  {
    color: '#fa8c16',
    description: 'Causal overclaiming, generalization, missing caveats',
    icon: '⚖️',
    id: 'claims',
    name: 'Claims & Identification',
    promptBuilder: (
      ctx,
    ) => `You are a skeptical methodologist enforcing "claim discipline" — claims must never exceed what identification allows.

Check:
1. **Causal language without causal identification**: Flag "causes", "leads to", "drives" when only correlation is shown
2. **Generalization beyond sample**: Claims extending beyond data scope
3. **Mechanism claims stated as facts**: Proposed explanations asserted rather than hypothesized
4. **Unsupported robustness claims**: "results are robust to X" without evidence
5. **Missing caveats**: Obvious threats to validity not discussed (selection bias, confounding, reverse causation, measurement error)
6. **Statistical vs clinical significance conflation**
7. **Literature overclaiming**: "first to show", "no prior study" — flag if likely false

Research: ${ctx.researchQuestion}
${ctx.abstracts}

Output format:
## Agent 3: Claims & Identification Integrity
### Causal Overclaiming (must address)
[Section | "Exact text" | Why it overclaims | Fix]
### Generalization Issues
[same format]
### Missing Caveats
[Topic | Where to address | Suggested text]`,
  },
  {
    color: '#722ed1',
    description: 'Statistical methods, formulas, notation, regression specs',
    icon: '📐',
    id: 'stats',
    name: 'Statistical Methods',
    promptBuilder: (
      ctx,
    ) => `You are a biostatistician reviewing the statistical methodology of a systematic review / meta-analysis.

Check:
1. **Appropriate statistical tests**: Are the right tests used for the data type?
2. **Effect measure consistency**: RR vs OR vs HR vs MD — used correctly?
3. **Heterogeneity assessment**: I², Q statistic, τ² — reported correctly?
4. **Meta-analysis model**: Fixed vs random effects — justified?
5. **Subgroup/sensitivity analyses**: Appropriate and pre-specified?
6. **Publication bias methods**: Funnel plot, Egger test, trim-and-fill — correctly applied?
7. **Confidence intervals**: 95% CI reported correctly?
8. **Multiple comparisons**: Adjustments needed?
9. **Missing data handling**: Described and appropriate?

Research: ${ctx.researchQuestion}
${ctx.abstracts}

Output format:
## Agent 4: Statistical Methods & Notation
### Statistical Errors
[Method | Error | Correction]
### Missing Analyses
[What is needed | Why | Impact on conclusions]
### Notation Issues
[Symbol/term | Inconsistency | Fix]`,
  },
  {
    color: '#eb2f96',
    description: 'PRISMA flow, forest plots, CONSORT/STROBE compliance',
    icon: '📊',
    id: 'reporting',
    name: 'Reporting & Compliance',
    promptBuilder: (
      ctx,
    ) => `You are a journal production editor reviewing reporting compliance of a systematic review.

Check compliance with:
1. **PRISMA 2020**: All 27 items — identification, screening, eligibility, inclusion
2. **CONSORT** (if RCTs): Randomisation, blinding, ITT, flow diagram
3. **STROBE** (if observational): Study design, participants, variables, bias
4. **Forest plot quality**: Labels, effect measure, CI, heterogeneity, model stated
5. **GRADE assessment**: Evidence quality rating for each outcome
6. **Risk of Bias reporting**: Tool used, domain-level assessment, summary
7. **Protocol registration**: PROSPERO or equivalent mentioned?
8. **Data availability statement**: Present?

Research: ${ctx.researchQuestion}
${ctx.abstracts}

Output format:
## Agent 5: Reporting & Compliance
### PRISMA Checklist Gaps
[Item # | Description | Status: Missing/Incomplete]
### CONSORT/STROBE Issues
[Guideline | Item | Issue]
### Figure/Table Documentation Gaps
[Element | Missing information | Suggested addition]`,
  },
  {
    color: '#f5222d',
    description: 'Adversarial referee persona for target journal',
    icon: '👨‍⚖️',
    id: 'referee',
    name: 'Adversarial Referee',
    promptBuilder: (
      ctx,
    ) => `You are a demanding associate editor at ${ctx.journal === 'top-medical' ? 'a leading medical journal' : ctx.journal}. You have extremely high standards. You are deciding whether this systematic review deserves to be sent to referees.

Evaluate:

**Part 1 — Central Contribution**: What does this review add? Is it genuinely new or a replication? Rate: [Transformative | Significant | Incremental | Insufficient]

**Part 2 — Methodological Rigor**: Search strategy quality, screening process, risk of bias assessment, synthesis methods, GRADE assessment

**Part 3 — Required Analyses**: 3-5 analyses that MUST be done before acceptance (robustness checks, sensitivity analyses, missing subgroups)

**Part 4 — Suggested Improvements**: 3-5 improvements that would strengthen but aren't blockers

**Part 5 — Literature Positioning**: Missing key references? Adequate differentiation from prior reviews?

**Part 6 — Journal Fit**: Is this suitable for ${ctx.journal === 'top-medical' ? 'a leading medical journal' : ctx.journal}? Recommendation: [Send to referees | Revise first | Desk reject]

**Part 7 — Questions to Authors**: 5-7 pointed questions a referee would ask

Research: ${ctx.researchQuestion}
${ctx.abstracts}

Output format:
## Agent 6: Adversarial Referee Report (${ctx.journal === 'top-medical' ? 'Leading Medical Journal' : ctx.journal})
### Part 1 — Central Contribution
[assessment + rating]
### Part 2 — Methodological Rigor
[assessment]
### Part 3 — Required Analyses
[numbered list]
### Part 4 — Suggested Improvements
[numbered list]
### Part 5 — Literature Positioning
[assessment]
### Part 6 — Journal Fit & Recommendation
[recommendation]
### Part 7 — Questions to Authors
[numbered list]`,
  },
];

const ManuscriptReviewer = memo(() => {
  const { styles } = useStyles();
  const allPapers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const searchQuery = useResearchStore((s) => s.searchQuery);
  const pico = useResearchStore((s) => s.pico);

  const papers = allPapers.filter((p) => screeningDecisions[p.id]?.decision === 'included');
  const researchQuestion = pico
    ? `${pico.population} | ${pico.intervention} vs ${pico.comparison} | Outcome: ${pico.outcome}`
    : searchQuery || 'Systematic review';

  const [journal, setJournal] = useState('top-medical');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [results, setResults] = useState<Record<string, AgentResult>>({});
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const abstracts = useMemo(() => {
    return papers
      .slice(0, 15)
      .map(
        (p, i) =>
          `[Study ${i + 1}] ${p.authors} (${p.year}). "${p.title}". ${p.journal || ''}.\nAbstract: ${p.abstract || '(No abstract)'}`,
      )
      .join('\n\n---\n\n');
  }, [papers]);

  const ctx: ReviewCtx = useMemo(
    () => ({
      abstracts,
      journal,
      paperCount: papers.length,
      researchQuestion,
    }),
    [abstracts, journal, papers.length, researchQuestion],
  );

  const runSingleAgent = useCallback(
    async (agent: AgentDef) => {
      setResults((prev) => ({ ...prev, [agent.id]: { output: '', status: 'running' } }));
      try {
        const prompt = agent.promptBuilder(ctx);
        const res = await fetch('/api/research/ai-summary', {
          body: JSON.stringify({ model, prompt }),
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
        if (!res.ok) {
          const errJson = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errJson.error || `Server error ${res.status}`);
        }
        const json = (await res.json()) as { text: string };
        setResults((prev) => ({
          ...prev,
          [agent.id]: { output: json.text || '(No output)', status: 'done' },
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setResults((prev) => ({
          ...prev,
          [agent.id]: {
            output: `⚠️ ${agent.name} failed:\n${msg}\n\nTip: Make sure you are logged in and have AI provider credits available.`,
            status: 'error',
          },
        }));
      }
    },
    [ctx, model],
  );

  const runAllAgents = useCallback(async () => {
    setRunning(true);
    // Run all 6 agents in parallel
    await Promise.all(AGENTS.map((agent) => runSingleAgent(agent)));
    setRunning(false);
  }, [runSingleAgent]);

  const consolidatedReport = useMemo(() => {
    const done = AGENTS.filter((a) => results[a.id]?.status === 'done');
    if (done.length === 0) return '';

    const date = new Date().toISOString().slice(0, 10);
    let report = `# Pre-Submission Manuscript Review\n\n`;
    report += `**Research**: ${researchQuestion}\n`;
    report += `**Included Studies**: ${papers.length}\n`;
    report += `**Review Standard**: ${journal === 'top-medical' ? 'Leading Medical Journal' : journal}\n`;
    report += `**Date**: ${date}\n`;
    report += `**AI Model**: ${model}\n\n---\n\n`;

    for (const agent of AGENTS) {
      const r = results[agent.id];
      if (r?.status === 'done') {
        report += `${r.output}\n\n---\n\n`;
      }
    }

    report += `## Priority Action Items\n\n`;
    report += `> Triage hierarchy: Identification failures > Missing analyses > Inconsistencies > Reporting gaps > Statistical errors > Style\n\n`;
    report += `*Review the agent outputs above and prioritize: CRITICAL → MAJOR → MINOR*\n\n`;
    report += `---\n\n*Generated by Phở Research Mode — Multi-Agent Manuscript Reviewer v1.0*\n`;
    return report;
  }, [results, researchQuestion, papers.length, journal, model]);

  const downloadReport = useCallback(() => {
    if (!consolidatedReport) return;
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([consolidatedReport], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PRE_SUBMISSION_REVIEW_${date}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [consolidatedReport]);

  const copyReport = useCallback(() => {
    navigator.clipboard.writeText(consolidatedReport);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [consolidatedReport]);

  const doneCount = AGENTS.filter((a) => results[a.id]?.status === 'done').length;
  const errorCount = AGENTS.filter((a) => results[a.id]?.status === 'error').length;

  const statusIcon = (status: AgentStatus) => {
    if (status === 'running')
      return <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />;
    if (status === 'done') return <CheckCircle size={14} style={{ color: '#52c41a' }} />;
    if (status === 'error') return <XCircle size={14} style={{ color: '#ff4d4f' }} />;
    return <Bot size={14} style={{ opacity: 0.3 }} />;
  };

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>🤖 Multi-Agent Manuscript Reviewer</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            6 specialized AI agents review your paper in parallel — inspired by top journal
            refereeing
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal>
          {doneCount > 0 && <Tag color="green">{doneCount}/6 complete</Tag>}
          {errorCount > 0 && <Tag color="red">{errorCount} errors</Tag>}
        </Flexbox>
      </Flexbox>

      {/* Config */}
      <div className={styles.card}>
        <Flexbox gap={12}>
          <Flexbox gap={10} horizontal wrap={'wrap'}>
            <Flexbox gap={2} style={{ flex: 1, minWidth: 200 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>🏥 Target Journal</span>
              <Select
                onChange={(v: string) => setJournal(v)}
                options={JOURNALS}
                style={{ width: '100%' }}
                value={journal}
              />
            </Flexbox>
            <Flexbox gap={2} style={{ flex: 1, minWidth: 180 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>🧠 AI Model</span>
              <Select
                onChange={(v: string) => setModel(v)}
                options={[
                  { label: 'Gemini 2.5 Flash (fast)', value: 'gemini-2.5-flash' },
                  { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
                  { label: 'GPT-4o (best)', value: 'gpt-4o' },
                  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
                  { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
                ]}
                style={{ width: '100%' }}
                value={model}
              />
            </Flexbox>
          </Flexbox>

          <Flexbox gap={4}>
            <span style={{ fontSize: 10, opacity: 0.6 }}>
              📋 Research: {researchQuestion} · {papers.length} included papers
            </span>
          </Flexbox>

          <Flexbox gap={8} horizontal>
            <Button
              icon={<Play size={14} />}
              loading={running}
              onClick={runAllAgents}
              type={'primary'}
            >
              {running ? 'Reviewing...' : '🚀 Run All 6 Agents'}
            </Button>
            {doneCount > 0 && (
              <>
                <Button icon={<Download size={14} />} onClick={downloadReport}>
                  Download Report
                </Button>
                <Button icon={<ClipboardCopy size={14} />} onClick={copyReport}>
                  {copied ? '✓ Copied!' : 'Copy Markdown'}
                </Button>
              </>
            )}
          </Flexbox>
        </Flexbox>
      </div>

      {/* Agent cards */}
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        }}
      >
        {AGENTS.map((agent) => {
          const r = results[agent.id];
          return (
            <div
              className={styles.card}
              key={agent.id}
              style={{ borderLeft: `3px solid ${agent.color}` }}
            >
              <Flexbox gap={6}>
                <Flexbox align={'center'} gap={6} horizontal>
                  {r ? statusIcon(r.status) : <Bot size={14} style={{ opacity: 0.3 }} />}
                  <span style={{ fontSize: 12, fontWeight: 700 }}>
                    {agent.icon} {agent.name}
                  </span>
                </Flexbox>
                <span style={{ fontSize: 10, opacity: 0.5 }}>{agent.description}</span>
                {!r && (
                  <Button
                    onClick={() => runSingleAgent(agent)}
                    size="small"
                    style={{ marginTop: 4 }}
                  >
                    Run Agent
                  </Button>
                )}
                {r?.status === 'running' && (
                  <Flexbox align={'center'} gap={6} horizontal style={{ opacity: 0.6 }}>
                    <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: 10 }}>Analyzing...</span>
                  </Flexbox>
                )}
                {r?.status === 'done' && (
                  <Tag color="green" style={{ fontSize: 9 }}>
                    ✓ Complete
                  </Tag>
                )}
                {r?.status === 'error' && (
                  <Flexbox align={'center'} gap={4} horizontal>
                    <AlertTriangle size={12} style={{ color: '#ff4d4f' }} />
                    <span style={{ color: '#ff4d4f', fontSize: 10 }}>Failed</span>
                  </Flexbox>
                )}
              </Flexbox>
            </div>
          );
        })}
      </div>

      {/* Results */}
      {doneCount > 0 && (
        <Collapse
          items={AGENTS.filter(
            (a) => results[a.id]?.status === 'done' || results[a.id]?.status === 'error',
          ).map((agent) => ({
            children: (
              <pre className={styles.output}>{results[agent.id]?.output || '(No output)'}</pre>
            ),
            key: agent.id,
            label: (
              <Flexbox align={'center'} gap={8} horizontal>
                {statusIcon(results[agent.id]?.status || 'idle')}
                <span>
                  {agent.icon} {agent.name}
                </span>
              </Flexbox>
            ),
          }))}
        />
      )}

      {/* No papers warning */}
      {papers.length === 0 && (
        <div className={styles.card} style={{ padding: 32, textAlign: 'center' }}>
          <Bot size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No included papers</div>
          <div style={{ fontSize: 11, opacity: 0.5 }}>
            Include papers in Screening phase first to enable manuscript review.
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid', fontSize: 10, opacity: 0.4, paddingTop: 6 }}>
        🤖 Inspired by claesbackman/AI-research-feedback · Adapted for medical systematic reviews ·
        6 agents: Style → Consistency → Claims → Statistics → Reporting → Referee
      </div>
    </Flexbox>
  );
});

ManuscriptReviewer.displayName = 'ManuscriptReviewer';
export default ManuscriptReviewer;
