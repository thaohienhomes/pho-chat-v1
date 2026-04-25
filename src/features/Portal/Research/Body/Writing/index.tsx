'use client';

import { Button, Tag } from '@lobehub/ui';
import { Input, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { Copy, FileText, Loader2, Sparkles } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useResearchStore } from '@/store/research';

// ── AI Writing helper ────────────────────────────────────────────────────
const aiWriteSection = async (
    sectionKey: string,
    sectionLabel: string,
    existingContent: string,
    context: {
        pico: { comparison: string; intervention: string; outcome: string; population: string } | null;
        query: string;
        refs: string;
    },
): Promise<string> => {
    const systemInstructions: Record<string, string> = {
        abstract: 'Write a structured abstract with Background, Objectives, Methods, Results, Conclusions sections. 250 words max.',
        conclusion: 'Write a concise conclusion paragraph summarizing key findings and recommendations for practice. 150 words.',
        discussion: 'Write an academic discussion section addressing: summary of findings, comparison with literature, limitations, and clinical implications.',
        introduction: 'Write an academic introduction with: background context, problem statement, and study objectives. 3 paragraphs.',
        methods: 'Write a systematic review Methods section covering: search strategy, inclusion/exclusion criteria, data extraction, and quality assessment.',
        results: 'Write a systematic review Results section covering: study selection (with numbers), study characteristics, and main findings synthesis.',
        title: 'Generate 3 alternative academic titles for this systematic review. Format as a numbered list.',
    };

    const instruction = systemInstructions[sectionKey] ?? `Write the ${sectionLabel} section for a systematic review.`;
    const picoText = context.pico
        ? `PICO: P=${context.pico.population}, I=${context.pico.intervention}, C=${context.pico.comparison}, O=${context.pico.outcome}`
        : `Research question: ${context.query}`;

    const prompt = [
        instruction,
        '',
        picoText,
        existingContent ? `\nExisting draft (improve this):\n${existingContent}` : '',
        context.refs
            ? `\n=== KEY REFERENCES (cite ONLY these — use [Author, Year] format) ===\n${context.refs}\n=== END REFERENCES ===`
            : `\n=== NO REFERENCES AVAILABLE ===\nDo NOT cite any specific studies, authors, or PMIDs. Use generic phrasing only.`,
        '\nIMPORTANT: When citing, use ONLY papers from the references above. Format: [Author, Year]. Do NOT invent citations.',
        '\nRespond in English. Academic register. Use markdown formatting.',
    ].join('\n');

    try {
        const res = await fetch('/api/chat/direct', {
            body: JSON.stringify({
                messages: [{ content: prompt, role: 'user' }],
                model: 'gpt-4o-mini',
                stream: false,
                temperature: 0.6,
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
        });
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        return data?.choices?.[0]?.message?.content ?? data?.content ?? '';
    } catch {
        // Fallback: template scaffold
        const templates: Record<string, string> = {
            abstract: `## Abstract\n\n**Background:** ${context.query}\n\n**Methods:** Systematic review following PRISMA guidelines.\n\n**Results:** [number] studies included.\n\n**Conclusions:** Further research warranted.`,
            conclusion: `This systematic review examined ${context.query}. The evidence suggests that [key finding]. Future research should focus on [gap].`,
            discussion: `## Discussion\n\nThis review identified [n] relevant studies. Our findings are consistent with [prior work]. Limitations include [search scope, language bias]. Clinical implications: [recommendation].`,
            introduction: `## Introduction\n\n${context.query} represents an important area of clinical inquiry.\n\nThe objective of this systematic review was to synthesize available evidence on this topic.`,
            methods: `## Methods\n\n### Search Strategy\nSearched PubMed, OpenAlex, and ClinicalTrials.gov.\n\n### ${picoText}\n\n### Eligibility Criteria\nIncluded: peer-reviewed studies addressing the PICO.`,
            results: `## Results\n\n### Study Selection\n[n] records identified, [m] included after screening.\n\n### Characteristics of Included Studies\n[Describe study designs, sample sizes, populations].`,
            title: `1. Effectiveness of ${context.pico?.intervention ?? '[intervention]'} in ${context.pico?.population ?? '[population]'}: A Systematic Review\n2. ${context.query}: A Systematic Review and Meta-Analysis\n3. ${context.pico?.intervention ?? '[intervention]'} versus ${context.pico?.comparison ?? '[comparison]'}: Evidence from a Systematic Review`,
        };
        return templates[sectionKey] ?? `[AI-generated ${sectionLabel} section - edit as needed]`;
    }
};

const { TextArea } = Input;

// Standard systematic review sections
const DEFAULT_SECTIONS = [
    { content: '', key: 'title', label: 'Title', placeholder: 'Systematic Review: [Your research question]' },
    { content: '', key: 'abstract', label: 'Abstract', placeholder: 'Background, Methods, Results, Conclusions...' },
    { content: '', key: 'introduction', label: 'Introduction', placeholder: 'Background context, rationale, and objectives...' },
    { content: '', key: 'methods', label: 'Methods', placeholder: 'Search strategy, eligibility criteria, data extraction, quality assessment...' },
    { content: '', key: 'results', label: 'Results', placeholder: 'Study selection (PRISMA), study characteristics, synthesis of results...' },
    { content: '', key: 'discussion', label: 'Discussion', placeholder: 'Summary of evidence, limitations, implications for practice...' },
    { content: '', key: 'conclusion', label: 'Conclusion', placeholder: 'Key findings and recommendations...' },
    { content: '', key: 'references', label: 'References', placeholder: 'Auto-generated from included papers...' },
];

const useStyles = createStyles(({ css, token }) => ({
    container: css`
    width: 100%;
  `,
    emptyState: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;

    padding: 48px 24px;

    color: ${token.colorTextQuaternary};
    text-align: center;
  `,
    sectionCard: css`
    padding: 12px 16px;

    background: ${token.colorFillQuaternary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    transition: all 0.2s;

    &:hover {
      border-color: ${token.colorPrimaryBorder};
    }
  `,
    sectionHeader: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    font-size: 13px;
    font-weight: 700;
    color: ${token.colorText};
  `,
    sectionLabel: css`
    display: flex;
    gap: 8px;
    align-items: center;

    font-size: 13px;
    font-weight: 700;
    color: ${token.colorText};
  `,
    sectionTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
    statItem: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 13px;
    font-weight: 600;
  `,
    statsCard: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    padding: 12px 16px;

    background: linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorFillQuaternary} 100%);
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: ${token.borderRadiusLG}px;
  `,
    wordCount: css`
    font-size: 11px;
    font-weight: 400;
    color: ${token.colorTextQuaternary};
  `,
}));

const WritingPhase = memo(() => {
    const { styles } = useStyles();

    const papers = useResearchStore((s) => s.papers);
    const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
    const pico = useResearchStore((s) => s.pico);
    const searchQuery = useResearchStore((s) => s.searchQuery);
    const setActivePhase = useResearchStore((s) => s.setActivePhase);

    const includedPapers = papers.filter((p) => screeningDecisions[p.id]?.decision === 'included');

    // Section state
    const [sections, setSections] = useState(() => {
        const filled = DEFAULT_SECTIONS.map((s) => ({ ...s }));

        if (searchQuery) filled[0].content = `Systematic Review: ${searchQuery}`;

        const methodsIdx = filled.findIndex((s) => s.key === 'methods');
        if (methodsIdx >= 0 && pico) {
            filled[methodsIdx].content = [
                '## Search Strategy',
                `Research Question: ${searchQuery}`,
                '',
                '### PICO Framework',
                `- **Population:** ${pico.population}`,
                `- **Intervention:** ${pico.intervention}`,
                `- **Comparison:** ${pico.comparison}`,
                `- **Outcome:** ${pico.outcome}`,
                '',
                '### Databases Searched',
                '- PubMed (MEDLINE)',
                '- OpenAlex',
                '',
                '### Selection Criteria',
                `- ${includedPapers.length} studies included after screening`,
                `- ${papers.length - includedPapers.length} studies excluded`,
            ].join('\n');
        }

        const refsIdx = filled.findIndex((s) => s.key === 'references');
        if (refsIdx >= 0) {
            filled[refsIdx].content = includedPapers.map((p, i) =>
                `${i + 1}. ${p.authors}. ${p.title}. ${p.journal || 'N/A'}. ${p.year}. ${p.doi ? `DOI: ${p.doi}` : ''}`,
            ).join('\n');
        }

        return filled;
    });

    const [expandedSection, setExpandedSection] = useState<string | null>('title');
    // Track which sections are AI-generating
    const [aiGenerating, setAiGenerating] = useState<Record<string, boolean>>({});

    const updateSection = (key: string, content: string) => {
        setSections((prev) => prev.map((s) => s.key === key ? { ...s, content } : s));
    };

    // AI write a section — MED-40
    const handleAIWrite = useCallback(async (sectionKey: string, sectionLabel: string, existingContent: string) => {
        setAiGenerating((prev) => ({ ...prev, [sectionKey]: true }));
        setExpandedSection(sectionKey); // open the section
        const refsText = includedPapers.slice(0, 8).map((p, i) => {
            const abstract = (p.abstract || '').slice(0, 250);
            const id = p.id?.startsWith('pubmed-')
                ? ` PMID:${p.id.replace('pubmed-', '')}`
                : (p.doi ? ` DOI:${p.doi}` : '');
            return `[${i + 1}] ${p.authors} (${p.year}). ${p.title}.${id}${abstract ? `\n    Abstract: ${abstract}${p.abstract && p.abstract.length > 250 ? '...' : ''}` : ''}`;
        }).join('\n\n');
        try {
            const result = await aiWriteSection(sectionKey, sectionLabel, existingContent, {
                pico, query: searchQuery, refs: refsText,
            });
            updateSection(sectionKey, result);
        } finally {
            setAiGenerating((prev) => ({ ...prev, [sectionKey]: false }));
        }
    }, [includedPapers, pico, searchQuery]);

    const totalWords = sections.reduce((sum, s) => sum + (s.content ? s.content.split(/\s+/).filter(Boolean).length : 0), 0);
    const completedSections = sections.filter((s) => s.content.trim().length > 0).length;

    const handleCopyAll = () => {
        const fullText = sections
            .filter((s) => s.content.trim())
            .map((s) => `# ${s.label}\n\n${s.content}`)
            .join('\n\n---\n\n');
        navigator.clipboard.writeText(fullText);
    };

    return (
        <Flexbox className={styles.container} gap={12}>
            {/* Writing Stats */}
            <div className={styles.statsCard}>
                <Flexbox gap={16} horizontal wrap={'wrap'}>
                    <span className={styles.statItem}>📝 {totalWords} words</span>
                    <span className={styles.statItem}>📄 {completedSections}/{sections.length} sections</span>
                    <span className={styles.statItem}>📚 {includedPapers.length} references</span>
                </Flexbox>
                <Button icon={<Copy size={14} />} onClick={handleCopyAll} size={'small'}>
                    Copy All
                </Button>
            </div>

            {/* Section Cards */}
            <Flexbox gap={8}>
                <span className={styles.sectionTitle}>✍️ Manuscript Sections</span>
                {sections.map((section, idx) => (
                    <div className={styles.sectionCard} key={section.key}>
                        <div
                            className={styles.sectionHeader}
                            onClick={() => setExpandedSection(expandedSection === section.key ? null : section.key)}
                        >
                            <span className={styles.sectionLabel}>
                                <FileText size={14} />
                                {idx + 1}. {section.label}
                                {section.content.trim() && (
                                    <Tag color="green" style={{ fontSize: 10 }}>✓</Tag>
                                )}
                                {aiGenerating[section.key] && (
                                    <Tag color="purple" style={{ fontSize: 9 }}>AI đang viết...</Tag>
                                )}
                            </span>
                            <Flexbox align={'center'} gap={4} horizontal onClick={(e) => e.stopPropagation()}>
                                {/* AI Write Button — MED-40 */}
                                {section.key !== 'references' && (
                                    <Tooltip title={`AI viết ${section.label} dựa trên PICO và paper chọn`}>
                                        <button
                                            disabled={aiGenerating[section.key]}
                                            onClick={() => handleAIWrite(section.key, section.label, section.content)}
                                            style={{
                                                alignItems: 'center',
                                                background: 'linear-gradient(135deg, rgba(114,46,209,0.12), rgba(22,119,255,0.08))',
                                                border: '1px solid rgba(114,46,209,0.3)',
                                                borderRadius: 6,
                                                color: '#722ed1',
                                                cursor: aiGenerating[section.key] ? 'not-allowed' : 'pointer',
                                                display: 'flex',
                                                fontSize: 11,
                                                fontWeight: 600,
                                                gap: 4,
                                                padding: '3px 8px',
                                            }}
                                            type="button"
                                        >
                                            {aiGenerating[section.key]
                                                ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                                                : <Sparkles size={11} />}
                                            AI
                                        </button>
                                    </Tooltip>
                                )}
                                <span className={styles.wordCount}>
                                    {section.content ? section.content.split(/\s+/).filter(Boolean).length : 0} words
                                    {expandedSection === section.key ? ' ▲' : ' ▼'}
                                </span>
                            </Flexbox>
                        </div>
                        {expandedSection === section.key && (
                            <div style={{ marginTop: 8 }}>
                                <TextArea
                                    autoSize={{ maxRows: 20, minRows: 4 }}
                                    onChange={(e) => updateSection(section.key, e.target.value)}
                                    placeholder={section.placeholder}
                                    style={{ fontSize: 13, lineHeight: 1.6 }}
                                    value={section.content}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </Flexbox>

            {/* Phase Navigation */}
            <Flexbox gap={8} horizontal justify={'space-between'}>
                <Button onClick={() => setActivePhase('analysis')} size={'small'}>
                    ← Back to Analysis
                </Button>
                <Button onClick={() => setActivePhase('publishing')} size={'small'} type={'primary'}>
                    → Proceed to Publishing
                </Button>
            </Flexbox>
        </Flexbox>
    );
});

WritingPhase.displayName = 'WritingPhase';

export default WritingPhase;
