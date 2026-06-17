'use client';

/**
 * AI Evidence Summarizer
 *
 * Uses the AI to synthesize findings from included papers in the research store.
 * Generates: narrative summary, PICO breakdown, key findings, limitations,
 * clinical implications, and a suggested conclusion for the Discussion section.
 *
 * Prompts are structured for systematic review writing following EQUATOR guidelines.
 */
import { Button, Tag } from '@lobehub/ui';
import { Select } from 'antd';
import { createStyles } from 'antd-style';
import { Brain, Copy, FileText, Loader, RefreshCw, Sparkles } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
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
    overflow-y: auto;

    max-height: 600px;
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    font-size: 13px;
    line-height: 1.7;
    white-space: pre-wrap;

    background: ${token.colorFillQuaternary};
  `,
}));

type SummaryType =
  | 'narrative'
  | 'pico_breakdown'
  | 'key_findings'
  | 'limitations'
  | 'clinical_implications'
  | 'discussion_draft';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type PromptFn = (abstracts: string, pico: string) => string;
const SUMMARY_PROMPTS: Record<
  SummaryType,
  { description: string; label: string; prompt: PromptFn }
> = {
  clinical_implications: {
    description: 'Clinical practice recommendations from the evidence',
    label: '🏥 Clinical Implications',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    prompt: (abstracts, pico) =>
      `You are a clinical expert writing a systematic review. Based on these study abstracts about ${pico}:\n\n${abstracts}\n\nWrite a concise "Clinical Implications" section (200-300 words) that:\n1. Summarizes what this means for clinical practice\n2. Identifies which patients would benefit most\n3. Notes any contraindications or cautions\n4. Suggests how to implement findings\n5. Identifies gaps requiring further research\n\nUse evidence-based, precise clinical language.`,
  },
  discussion_draft: {
    description: 'Full Discussion section draft for manuscript',
    label: '📝 Discussion Draft',
    prompt: (abstracts, pico) =>
      `You are writing the Discussion section of a systematic review about ${pico}.\n\nBased on these abstracts:\n${abstracts}\n\nWrite a structured Discussion (400-600 words) with:\n1. **Summary of main findings** — headline result and magnitude of effect\n2. **Comparison with prior reviews** — how findings align or differ\n3. **Possible explanations** for heterogeneity or unexpected findings\n4. **Strengths and limitations** of the included studies\n5. **Generalizability** — who the findings apply to\n6. **Future research** — what's still needed\n\nUse academic, third-person style. Cite studies as (Author Year).`,
  },
  key_findings: {
    description: 'Key numerical findings and effect sizes',
    label: '📊 Key Findings',
    prompt: (abstracts, pico) =>
      `You are an expert systematic reviewer. From these abstracts about ${pico}:\n\n${abstracts}\n\nExtract and structure the KEY FINDINGS as:\n\n## Primary Outcomes\n- [Most important result, n= studies, RR/OR/MD if mentioned]\n\n## Secondary Outcomes\n- [Other outcomes]\n\n## Subgroup Insights\n- [Notable subgroup differences]\n\n## Heterogeneity\n- [Consistency of results]\n\nBe specific with numbers where available. Flag any conflicting results.`,
  },
  limitations: {
    description: 'Study limitations and sources of bias',
    label: '⚠️ Limitations',
    prompt: (abstracts, pico) =>
      `Based on these study abstracts about ${pico}:\n\n${abstracts}\n\nIdentify and categorize the LIMITATIONS in a structured format:\n\n## Methodological Limitations\n- [Design issues, selection bias, etc.]\n\n## Heterogeneity Sources\n- [Population, intervention, outcome differences]\n\n## Evidence Gaps\n- [What's missing from the literature]\n\n## Reporting Issues\n- [Missing data, publication bias risk]\n\n## Generalizability Concerns\n- [Who the findings may NOT apply to]\n\nBe critical and specific. This is for a peer-reviewed systematic review.`,
  },
  narrative: {
    description: 'Paragraph narrative synthesis of all included papers',
    label: '📖 Narrative Summary',
    prompt: (abstracts, pico) =>
      `You are an expert systematic reviewer. Synthesize the following study abstracts about ${pico} into a narrative summary (300-400 words) following PRISMA guidelines:\n\n${abstracts}\n\nStructure the narrative as:\n1. Overall direction and magnitude of effect\n2. Consistency across studies (heterogeneity)\n3. Quality of evidence\n4. Notable exceptions or outliers\n\nUse hedged academic language. Do NOT use bullet points — this should flow as journal prose.`,
  },
  pico_breakdown: {
    description: 'PICO framework extraction from all studies',
    label: '🎯 PICO Breakdown',
    prompt: (abstracts, pico) =>
      `From these systematic review abstracts about ${pico}:\n\n${abstracts}\n\nExtract a PICO breakdown TABLE:\n\n| Element | Range across studies |\n|---------|--------------------|\\n| **Population** | [age range, conditions, settings] |\n| **Intervention** | [types, doses, durations] |\n| **Comparator** | [controls used] |\n| **Outcomes** | [primary, secondary, follow-up] |\n| **Study designs** | [RCT, cohort, etc.] |\n| **Sample sizes** | [range, median] |\n| **Follow-up** | [range] |\n\nThen summarize clinical heterogeneity in 3-4 sentences.`,
  },
};

const EvidenceSummarizer = memo(() => {
  const { styles } = useStyles();
  const allPapers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const papers = allPapers.filter((p) => screeningDecisions[p.id]?.decision === 'included');
  const searchQuery = useResearchStore((s) => s.searchQuery);
  const pico = useResearchStore((s) => s.pico);

  const [summaryType, setSummaryType] = useState<SummaryType>('narrative');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedPapers, setSelectedPapers] = useState<string[]>([]);
  const [model, setModel] = useState('gpt-4o-mini');

  const papersToUse =
    selectedPapers.length > 0 ? papers.filter((p) => selectedPapers.includes(p.id)) : papers;

  const buildAbstracts = useCallback(() => {
    return papersToUse
      .map(
        (p, i) =>
          `[${i + 1}] ${p.authors} (${p.year}). "${p.title}".\n${p.abstract || '(No abstract available)'}`,
      )
      .join('\n\n---\n\n');
  }, [papersToUse]);

  const summarize = useCallback(async () => {
    if (papersToUse.length === 0) return;
    setLoading(true);
    setOutput('');

    const abstracts = buildAbstracts();
    const researchQuestion = pico
      ? `${pico.population} receiving ${pico.intervention} vs ${pico.comparison} on ${pico.outcome}`
      : searchQuery || 'the specified research question';
    const config = SUMMARY_PROMPTS[summaryType];
    const prompt = config.prompt(abstracts, researchQuestion);

    try {
      const res = await fetch('/api/research/ai-summary', {
        body: JSON.stringify({ model, prompt }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error((errJson as any).error || `Server error ${res.status}`);
      }

      const json = (await res.json()) as { model?: string; provider?: string; text: string };
      setOutput(json.text || '(No content returned)');
    } catch (err) {
      setOutput(
        `⚠️ Error calling AI: ${String(err)}\n\nAi Synthesis requires a valid session and at least one configured AI provider.`,
      );
    } finally {
      setLoading(false);
    }
  }, [papersToUse, buildAbstracts, searchQuery, pico, summaryType, model]);

  const copyOutput = useCallback(() => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  if (papers.length === 0) {
    return (
      <div className={styles.card} style={{ padding: 32, textAlign: 'center' }}>
        <Brain size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No included papers</div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>
          Include papers in the Screening phase first, then come back here to synthesize evidence.
        </div>
      </div>
    );
  }

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>🧠 AI Evidence Summarizer</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Synthesize {papers.length} included papers using structured AI prompts for systematic
            review writing
          </span>
        </Flexbox>
        <Tag color="blue">✓ {papers.length} papers included</Tag>
      </Flexbox>

      {/* Config row */}
      <div className={styles.card}>
        <Flexbox gap={12}>
          <Flexbox align={'flex-start'} gap={10} horizontal wrap={'wrap'}>
            <Flexbox gap={2} style={{ flex: '2', minWidth: 200 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Summary type</span>
              <Select
                onChange={(v: SummaryType) => setSummaryType(v)}
                options={Object.entries(SUMMARY_PROMPTS).map(([value, { label, description }]) => ({
                  label: (
                    <Flexbox gap={2}>
                      <span>{label}</span>
                      <span style={{ fontSize: 10, opacity: 0.5 }}>{description}</span>
                    </Flexbox>
                  ),
                  value,
                }))}
                style={{ width: '100%' }}
                value={summaryType}
              />
            </Flexbox>
            <Flexbox gap={2} style={{ minWidth: 160 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>AI Model</span>
              <Select
                onChange={(v: string) => setModel(v)}
                options={[
                  { label: 'GPT-4o Mini (fast)', value: 'gpt-4o-mini' },
                  { label: 'GPT-4o (best)', value: 'gpt-4o' },
                  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
                  { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
                  { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
                ]}
                style={{ width: '100%' }}
                value={model}
              />
            </Flexbox>
          </Flexbox>

          {/* Paper selection */}
          <Flexbox gap={2}>
            <Flexbox align={'center'} gap={8} horizontal>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Papers to include</span>
              <Tag style={{ fontSize: 9 }}>{papersToUse.length} selected</Tag>
              <button
                onClick={() => setSelectedPapers([])}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 10,
                  opacity: 0.5,
                }}
                type="button"
              >
                {selectedPapers.length > 0 ? 'clear → use all' : 'all included'}
              </button>
            </Flexbox>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {papers.map((p) => {
                const isSelected = selectedPapers.length === 0 || selectedPapers.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() =>
                      setSelectedPapers((prev) =>
                        prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                      )
                    }
                    style={{
                      background: isSelected ? '#1890ff18' : 'transparent',
                      border: `1px solid ${isSelected ? '#1890ff' : 'rgba(128,128,128,0.3)'}`,
                      borderRadius: 4,
                      color: 'inherit',
                      cursor: 'pointer',
                      fontSize: 10,
                      padding: '2px 6px',
                    }}
                    type="button"
                  >
                    {p.authors.split(',')[0]} {p.year}
                  </button>
                );
              })}
            </div>
          </Flexbox>

          <Flexbox gap={8} horizontal>
            <Button
              icon={loading ? <Loader size={13} /> : <Sparkles size={13} />}
              loading={loading}
              onClick={summarize}
              type={'primary'}
            >
              {loading ? 'Synthesizing…' : `Generate ${SUMMARY_PROMPTS[summaryType].label}`}
            </Button>
            {output && (
              <Button icon={<RefreshCw size={12} />} onClick={() => setOutput('')}>
                Clear
              </Button>
            )}
          </Flexbox>
        </Flexbox>
      </div>

      {/* Output */}
      {loading && !output && (
        <Flexbox align={'center'} gap={12} style={{ minHeight: 120, opacity: 0.6 }}>
          <Loader size={24} />
          <span style={{ fontSize: 12 }}>AI is synthesizing {papersToUse.length} papers…</span>
        </Flexbox>
      )}

      {output && (
        <Flexbox gap={8}>
          <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
            <Flexbox align={'center'} gap={6} horizontal>
              <FileText size={14} style={{ color: '#1890ff' }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>
                {SUMMARY_PROMPTS[summaryType].label}
              </span>
              <Tag color="blue">{model}</Tag>
            </Flexbox>
            <Button icon={<Copy size={12} />} onClick={copyOutput} size="small">
              {copied ? '✓ Copied!' : 'Copy'}
            </Button>
          </Flexbox>
          <div className={styles.output}>{output}</div>
        </Flexbox>
      )}

      {/* Tips */}
      {!output && !loading && (
        <div className={styles.card}>
          <Flexbox gap={8}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>💡 Prompt strategies:</span>
            {[
              {
                color: '#1890ff',
                label: 'Start with "Key Findings"',
                tip: 'Get the numbers first, then build the narrative around them',
              },
              {
                color: '#52c41a',
                label: 'Use "PICO Breakdown"',
                tip: 'Identify clinical heterogeneity before pooling results',
              },
              {
                color: '#fa8c16',
                label: '"Discussion Draft" last',
                tip: 'After you have all sections, generate the full Discussion to pull it together',
              },
              {
                color: '#722ed1',
                label: 'Select subsets',
                tip: 'Run the summarizer on subgroups (e.g., only RCTs) to compare with observational studies',
              },
            ].map(({ label, tip, color }) => (
              <Flexbox align={'flex-start'} gap={8} horizontal key={label}>
                <div
                  style={{
                    background: color,
                    borderRadius: 3,
                    flexShrink: 0,
                    height: 8,
                    marginTop: 4,
                    width: 8,
                  }}
                />
                <span style={{ fontSize: 11 }}>
                  <strong>{label}</strong> — {tip}
                </span>
              </Flexbox>
            ))}
          </Flexbox>
        </div>
      )}
    </Flexbox>
  );
});

EvidenceSummarizer.displayName = 'EvidenceSummarizer';
export default EvidenceSummarizer;
