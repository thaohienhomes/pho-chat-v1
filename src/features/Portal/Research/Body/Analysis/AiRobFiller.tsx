'use client';

/**
 * AI Risk of Bias Auto-filler
 *
 * Reads abstracts of included papers and uses AI to suggest Risk of Bias
 * assessments for each Cochrane RoB 2.0 domain. The researcher can review,
 * accept, or override each suggestion before exporting.
 *
 * Domains: Randomisation, Deviations, Missing data, Measurement, Selection
 */
import { Button, Tag } from '@lobehub/ui';
import { Select } from 'antd';
import { createStyles } from 'antd-style';
import { Bot, CheckCircle, Copy, Loader, RefreshCw, XCircle } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useResearchStore } from '@/store/research';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  container: css`
    width: 100%;
  `,
}));

type RoBLevel = 'High' | 'Low' | 'Some concerns';

interface RoBAssessment {
  D1_randomisation: RoBLevel;
  D2_deviations: RoBLevel;
  D3_missing: RoBLevel;
  D4_measurement: RoBLevel;
  D5_selection: RoBLevel;
  justification: string;
  overall: RoBLevel;
}

const DOMAINS = [
  { key: 'D1_randomisation', label: 'D1: Randomisation process' },
  { key: 'D2_deviations', label: 'D2: Deviations from interventions' },
  { key: 'D3_missing', label: 'D3: Missing outcome data' },
  { key: 'D4_measurement', label: 'D4: Measurement of outcome' },
  { key: 'D5_selection', label: 'D5: Selection of reported result' },
  { key: 'overall', label: 'Overall' },
] as const;

const robColor = (level: RoBLevel) =>
  level === 'Low' ? '#52c41a' : level === 'High' ? '#ff4d4f' : '#faad14';

const robIcon = (level: RoBLevel) =>
  level === 'Low' ? (
    <CheckCircle size={12} style={{ color: '#52c41a' }} />
  ) : level === 'High' ? (
    <XCircle size={12} style={{ color: '#ff4d4f' }} />
  ) : (
    <Bot size={12} style={{ color: '#faad14' }} />
  );

const AiRobFiller = memo(() => {
  const { styles } = useStyles();
  const allPapers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const papers = allPapers.filter((p) => screeningDecisions[p.id]?.decision === 'included');

  const [assessments, setAssessments] = useState<Record<string, RoBAssessment>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [selectedPaper, setSelectedPaper] = useState<string>(papers[0]?.id ?? '');
  const [copied, setCopied] = useState(false);

  const assessSingle = useCallback(
    async (paperId: string) => {
      const paper = papers.find((p) => p.id === paperId);
      if (!paper) return;

      setLoading((prev) => ({ ...prev, [paperId]: true }));

      const prompt = `You are a systematic review methodologist. Based on this study information, provide a Risk of Bias 2.0 assessment.

Study: ${paper.authors} (${paper.year}). "${paper.title}"
Journal: ${paper.journal || 'Unknown'}
Abstract: ${paper.abstract || '(No abstract available)'}

Respond ONLY in valid JSON format:
{
  "D1_randomisation": "Low" | "Some concerns" | "High",
  "D2_deviations": "Low" | "Some concerns" | "High",
  "D3_missing": "Low" | "Some concerns" | "High",
  "D4_measurement": "Low" | "Some concerns" | "High",
  "D5_selection": "Low" | "Some concerns" | "High",
  "overall": "Low" | "Some concerns" | "High",
  "justification": "Brief 2-3 sentence justification"
}

If insufficient information, default to "Some concerns" and note in justification.`;

      try {
        const res = await fetch('/api/research/ai-summary', {
          body: JSON.stringify({ model: 'gpt-4o-mini', prompt }),
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });

        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const json = (await res.json()) as { text: string };

        // Extract JSON from response (handle markdown code blocks)
        let raw = json.text.trim();
        const jsonMatch = raw.match(/{[\S\s]*}/);
        if (jsonMatch) raw = jsonMatch[0];
        const parsed = JSON.parse(raw) as RoBAssessment;
        setAssessments((prev) => ({ ...prev, [paperId]: parsed }));
      } catch (err) {
        setAssessments((prev) => ({
          ...prev,
          [paperId]: {
            D1_randomisation: 'Some concerns',
            D2_deviations: 'Some concerns',
            D3_missing: 'Some concerns',
            D4_measurement: 'Some concerns',
            D5_selection: 'Some concerns',
            justification: `AI assessment failed: ${String(err)}. Please assess manually.`,
            overall: 'Some concerns',
          },
        }));
      } finally {
        setLoading((prev) => ({ ...prev, [paperId]: false }));
      }
    },
    [papers],
  );

  const assessAll = useCallback(async () => {
    for (const p of papers) {
      if (!assessments[p.id]) {
        await assessSingle(p.id);
      }
    }
  }, [papers, assessments, assessSingle]);

  const updateDomain = useCallback((paperId: string, domain: string, level: RoBLevel) => {
    setAssessments((prev) => ({
      ...prev,
      [paperId]: { ...prev[paperId], [domain]: level },
    }));
  }, []);

  const exportMarkdown = useCallback(() => {
    let md = `# Risk of Bias Assessment (RoB 2.0)\n\n`;
    md += `| Study | D1 | D2 | D3 | D4 | D5 | Overall | Justification |\n`;
    md += `|-------|----|----|----|----|----|---------|---------|\n`;
    for (const p of papers) {
      const a = assessments[p.id];
      if (!a) continue;
      const author = p.authors.split(',')[0]?.trim() || 'Unknown';
      md += `| ${author} ${p.year} | ${a.D1_randomisation} | ${a.D2_deviations} | ${a.D3_missing} | ${a.D4_measurement} | ${a.D5_selection} | ${a.overall} | ${a.justification.slice(0, 60)} |\n`;
    }
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [papers, assessments]);

  const assessedCount = Object.keys(assessments).length;

  if (papers.length === 0) {
    return (
      <div className={styles.card} style={{ padding: 32, textAlign: 'center' }}>
        <Bot size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No included papers</div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>Include papers in Screening phase first.</div>
      </div>
    );
  }

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            🤖 AI Risk of Bias Auto-filler (RoB 2.0)
          </span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            AI suggests RoB assessments from abstracts — review and override before using
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal>
          <Tag color={assessedCount === papers.length ? 'green' : 'blue'}>
            {assessedCount}/{papers.length} assessed
          </Tag>
          <Button
            icon={<Bot size={12} />}
            loading={Object.values(loading).some(Boolean)}
            onClick={assessAll}
          >
            Auto-assess all
          </Button>
          <Button icon={<Copy size={12} />} onClick={exportMarkdown}>
            {copied ? '✓ Copied!' : 'Copy Table'}
          </Button>
        </Flexbox>
      </Flexbox>

      {/* Paper selector */}
      <Select
        onChange={(v: string) => setSelectedPaper(v)}
        options={papers.map((p) => {
          const a = assessments[p.id];
          return {
            label: (
              <Flexbox align={'center'} gap={6} horizontal>
                {a ? robIcon(a.overall) : <span style={{ fontSize: 10, opacity: 0.4 }}>⏳</span>}
                <span>{p.title.slice(0, 65)}</span>
              </Flexbox>
            ),
            value: p.id,
          };
        })}
        style={{ width: '100%' }}
        value={selectedPaper}
      />

      {/* Assessment panel */}
      {selectedPaper &&
        (() => {
          const paper = papers.find((p) => p.id === selectedPaper);
          if (!paper) return null;
          const a = assessments[selectedPaper];
          const isLoading = loading[selectedPaper];

          return (
            <div className={styles.card}>
              <Flexbox gap={12}>
                <Flexbox align={'flex-start'} gap={8} horizontal justify={'space-between'}>
                  <Flexbox gap={2}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{paper.title}</span>
                    <span style={{ fontSize: 10, opacity: 0.5 }}>
                      {paper.authors} · {paper.year} · {paper.journal}
                    </span>
                  </Flexbox>
                  <Button
                    icon={isLoading ? <Loader size={12} /> : <RefreshCw size={12} />}
                    loading={isLoading}
                    onClick={() => assessSingle(selectedPaper)}
                    size="small"
                  >
                    {a ? 'Re-assess' : 'Assess'}
                  </Button>
                </Flexbox>

                {isLoading && (
                  <Flexbox align={'center'} gap={8} style={{ opacity: 0.6 }}>
                    <Loader size={20} />
                    <span style={{ fontSize: 11 }}>
                      AI is reading abstract and assessing bias...
                    </span>
                  </Flexbox>
                )}

                {a && !isLoading && (
                  <Flexbox gap={8}>
                    {DOMAINS.map(({ key, label }) => (
                      <Flexbox
                        align={'center'}
                        gap={8}
                        horizontal
                        justify={'space-between'}
                        key={key}
                      >
                        <Flexbox align={'center'} gap={6} horizontal>
                          {robIcon(a[key])}
                          <span style={{ fontSize: 11 }}>{label}</span>
                        </Flexbox>
                        <Flexbox gap={4} horizontal>
                          {(['Low', 'Some concerns', 'High'] as RoBLevel[]).map((level) => (
                            <button
                              key={level}
                              onClick={() => updateDomain(selectedPaper, key, level)}
                              style={{
                                background:
                                  a[key] === level ? robColor(level) + '22' : 'transparent',
                                border: `1px solid ${a[key] === level ? robColor(level) : 'rgba(128,128,128,0.2)'}`,
                                borderRadius: 4,
                                color: a[key] === level ? robColor(level) : 'inherit',
                                cursor: 'pointer',
                                fontSize: 10,
                                padding: '2px 8px',
                              }}
                              type="button"
                            >
                              {level}
                            </button>
                          ))}
                        </Flexbox>
                      </Flexbox>
                    ))}

                    <div
                      style={{
                        borderTop: '1px solid rgba(128,128,128,0.2)',
                        fontSize: 11,
                        marginTop: 4,
                        opacity: 0.7,
                        paddingTop: 8,
                      }}
                    >
                      <strong>AI Justification:</strong> {a.justification}
                    </div>
                  </Flexbox>
                )}
              </Flexbox>
            </div>
          );
        })()}

      {/* Overview table */}
      {assessedCount > 0 && (
        <div className={styles.card}>
          <Flexbox gap={8}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>📊 Summary Table</span>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 10, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '4px 8px', textAlign: 'left' }}>Study</th>
                    {DOMAINS.map((d) => (
                      <th key={d.key} style={{ padding: '4px 6px', textAlign: 'center' }}>
                        {d.label.replace(/D\d: /, '')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {papers.map((p) => {
                    const a = assessments[p.id];
                    if (!a) return null;
                    return (
                      <tr key={p.id}>
                        <td style={{ padding: '4px 8px' }}>
                          {p.authors.split(',')[0]} {p.year}
                        </td>
                        {DOMAINS.map((d) => (
                          <td key={d.key} style={{ padding: '4px 6px', textAlign: 'center' }}>
                            <span
                              style={{
                                background: robColor(a[d.key]) + '22',
                                borderRadius: 3,
                                color: robColor(a[d.key]),
                                fontSize: 9,
                                fontWeight: 700,
                                padding: '1px 6px',
                              }}
                            >
                              {a[d.key] === 'Low' ? '+' : a[d.key] === 'High' ? '−' : '?'}
                            </span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Flexbox>
        </div>
      )}

      <div style={{ borderTop: '1px solid', fontSize: 10, opacity: 0.4, paddingTop: 6 }}>
        📚 Cochrane Risk of Bias 2.0 · Sterne JAG et al. BMJ 2019;366:l4898
      </div>
    </Flexbox>
  );
});

AiRobFiller.displayName = 'AiRobFiller';
export default AiRobFiller;
