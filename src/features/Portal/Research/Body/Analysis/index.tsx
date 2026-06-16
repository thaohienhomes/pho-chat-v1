'use client';

import { Button, Tag } from '@lobehub/ui';
import { Progress, Tabs, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronLeft } from 'lucide-react';
import { memo, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { type PaperResult, useResearchStore } from '@/store/research';

import AiRobFiller from './AiRobFiller';
import BibExport from './BibExport';
import CitationNetwork from './CitationNetwork';
import ConsortStrobe from './ConsortStrobe';
import DataAnalyzer from './DataAnalyzer';
import DataExtractionForm from './DataExtractionForm';
import DeduplicationEngine from './DeduplicationEngine';
import DoiResolver from './DoiResolver';
import EvidenceSummarizer from './EvidenceSummarizer';
import ForestPlot from './ForestPlot';
import GradeSoF from './GradeSoF';
import ImpactFactor from './ImpactFactor';
import InteractiveSimulators from './InteractiveSimulators';
import JournalRecommender from './JournalRecommender';
import KappaCalculator from './KappaCalculator';
import KnowledgeBase from './KnowledgeBase';
import LearningModules from './LearningModules';
import ManuscriptReviewer from './ManuscriptReviewer';
import ManuscriptTimeline from './ManuscriptTimeline';
import MetaRegression from './MetaRegression';
import NntCalculator from './NntCalculator';
import PeerReviewSim from './PeerReviewSim';
import PowerCalculator from './PowerCalculator';
import PrismaDiagram from './PrismaDiagram';
import ProsperoHelper from './ProsperoHelper';
import PublicationBias from './PublicationBias';
import RevManExport from './RevManExport';
import RisImporter from './RisImporter';
import RiskOfBias from './RiskOfBias';
import StatTestAdvisor from './StatTestAdvisor';
import SubgroupAnalysis from './SubgroupAnalysis';

// GRADE levels
type GradeLevel = 'high' | 'moderate' | 'low' | 'very_low';

const GRADE_CONFIG: Record<GradeLevel, { color: string; label: string }> = {
  high: { color: '#52c41a', label: 'High' },
  low: { color: '#faad14', label: 'Low' },
  moderate: { color: '#1890ff', label: 'Moderate' },
  very_low: { color: '#ff4d4f', label: 'Very Low' },
};

const useStyles = createStyles(({ css, token }) => ({
  cellText: css`
    font-size: 11px;
    color: ${token.colorTextSecondary};
    white-space: nowrap;
  `,
  container: css`
    width: 100%;
  `,
  domainDesc: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  domainLabel: css`
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  emptyState: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;

    padding-block: 48px;
    padding-inline: 24px;

    color: ${token.colorTextQuaternary};
    text-align: center;
  `,
  evidenceTable: css`
    overflow-x: auto;
    width: 100%;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
  `,
  gradeBadge: css`
    display: inline-flex;
    align-items: center;

    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 12px;

    font-size: 11px;
    font-weight: 700;
  `,
  gradeCard: css`
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillQuaternary};
  `,
  gradeDomain: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 8px;
    padding-inline: 0;
    border-block-end: 1px solid ${token.colorBorder};

    &:last-child {
      border-block-end: none;
    }
  `,
  sectionTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
  studyTitle: css`
    overflow: hidden;

    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    color: ${token.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  summaryCard: css`
    padding: 16px;
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: ${token.borderRadiusLG}px;
    background: linear-gradient(
      135deg,
      ${token.colorPrimaryBg} 0%,
      ${token.colorFillQuaternary} 100%
    );
  `,
  tableHeader: css`
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
    gap: 8px;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    font-size: 11px;
    font-weight: 700;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;

    background: ${token.colorFillQuaternary};
  `,
  tableRow: css`
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${token.colorBorder};

    font-size: 12px;
    color: ${token.colorText};

    &:last-child {
      border-block-end: none;
    }

    &:hover {
      background: ${token.colorFillQuaternary};
    }
  `,
}));

// Simple study type inference from paper data
const inferStudyType = (paper: PaperResult): string => {
  const title = paper.title.toLowerCase();
  if (title.includes('meta-analysis') || title.includes('meta analysis')) return 'Meta-analysis';
  if (title.includes('systematic review')) return 'Systematic Review';
  if (title.includes('randomized') || title.includes('randomised') || title.includes('rct'))
    return 'RCT';
  if (title.includes('cohort')) return 'Cohort Study';
  if (title.includes('case-control') || title.includes('case control')) return 'Case-Control';
  if (title.includes('cross-sectional')) return 'Cross-sectional';
  if (title.includes('trial')) return 'Clinical Trial';
  if (title.includes('review')) return 'Review';
  return 'Observational';
};

// Simple GRADE assessment based on study characteristics
const assessGradeLevel = (papers: PaperResult[]): GradeLevel => {
  const types = papers.map(inferStudyType);
  const hasMetaAnalysis = types.includes('Meta-analysis');
  const hasSR = types.includes('Systematic Review');
  const hasRCT = types.includes('RCT');
  const rctCount = types.filter((t) => t === 'RCT').length;

  if (hasMetaAnalysis && hasSR && rctCount >= 2) return 'high';
  if (hasRCT || hasMetaAnalysis || hasSR) return 'moderate';
  if (papers.length >= 5) return 'low';
  return 'very_low';
};

// GRADE domains
const GRADE_DOMAINS = [
  { desc: 'Limitations in study design', key: 'riskOfBias', label: 'Risk of Bias' },
  { desc: 'Variation in results across studies', key: 'inconsistency', label: 'Inconsistency' },
  { desc: 'Applicability to target population', key: 'indirectness', label: 'Indirectness' },
  { desc: 'Confidence in the effect estimate', key: 'imprecision', label: 'Imprecision' },
  { desc: 'Selective reporting of outcomes', key: 'publicationBias', label: 'Publication Bias' },
];

const AnalysisPhase = memo(() => {
  const { styles } = useStyles();

  const papers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const setActivePhase = useResearchStore((s) => s.setActivePhase);

  const includedPapers = useMemo(
    () => papers.filter((p) => screeningDecisions[p.id]?.decision === 'included'),
    [papers, screeningDecisions],
  );

  const gradeLevel = useMemo(() => assessGradeLevel(includedPapers), [includedPapers]);
  const gradeConfig = GRADE_CONFIG[gradeLevel];

  // Study type distribution
  const typeDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const paper of includedPapers) {
      const type = inferStudyType(paper);
      counts[type] = (counts[type] || 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [includedPapers]);

  // Year range
  const yearRange = useMemo(() => {
    const years = includedPapers.map((p) => p.year).filter((y) => y > 0);
    if (years.length === 0) return 'N/A';
    return `${Math.min(...years)}–${Math.max(...years)}`;
  }, [includedPapers]);

  // Total citations
  const totalCitations = useMemo(
    () => includedPapers.reduce((sum, p) => sum + (p.citations || 0), 0),
    [includedPapers],
  );

  if (includedPapers.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span style={{ fontSize: 48 }}>📊</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>No papers for analysis</span>
        <span style={{ fontSize: 13 }}>Go back to Screening and include papers first.</span>
        <Button onClick={() => setActivePhase('screening')} size={'small'} type={'primary'}>
          <ChevronLeft size={14} /> Back to Screening
        </Button>
      </div>
    );
  }

  return (
    <Flexbox className={styles.container} gap={0}>
      <Tabs
        defaultActiveKey="evidence"
        items={[
          {
            children: (
              <Flexbox gap={16}>
                {/* Summary Card */}
                <div className={styles.summaryCard}>
                  <Flexbox gap={12}>
                    <Flexbox align={'center'} gap={12} horizontal justify={'space-between'}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>📊 Evidence Summary</span>
                      <span
                        className={styles.gradeBadge}
                        style={{ background: gradeConfig.color + '20', color: gradeConfig.color }}
                      >
                        GRADE: {gradeConfig.label}
                      </span>
                    </Flexbox>
                    <Flexbox gap={8} horizontal wrap={'wrap'}>
                      <Tag>{includedPapers.length} studies included</Tag>
                      <Tag>📅 {yearRange}</Tag>
                      <Tag>📝 {totalCitations.toLocaleString()} total citations</Tag>
                    </Flexbox>
                  </Flexbox>
                </div>

                {/* PRISMA 2020 Flowchart */}
                <PrismaDiagram />

                {/* Study Type Distribution */}
                <Flexbox gap={8}>
                  <span className={styles.sectionTitle}>📋 Study Type Distribution</span>
                  <div className={styles.gradeCard}>
                    {typeDistribution.map(([type, count]) => (
                      <Flexbox
                        align={'center'}
                        gap={12}
                        horizontal
                        justify={'space-between'}
                        key={type}
                        style={{ padding: '6px 0' }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{type}</span>
                        <Flexbox align={'center'} gap={8} horizontal>
                          <Progress
                            percent={Math.round((count / includedPapers.length) * 100)}
                            showInfo={false}
                            size={'small'}
                            style={{ width: 80 }}
                          />
                          <span style={{ fontSize: 11, minWidth: 40, textAlign: 'right' }}>
                            {count} ({Math.round((count / includedPapers.length) * 100)}%)
                          </span>
                        </Flexbox>
                      </Flexbox>
                    ))}
                  </div>
                </Flexbox>

                {/* Evidence Table */}
                <Flexbox gap={8}>
                  <span className={styles.sectionTitle}>📄 Evidence Table</span>
                  <div className={styles.evidenceTable}>
                    <div className={styles.tableHeader}>
                      <span>Study</span>
                      <span>Type</span>
                      <span>Year</span>
                      <span>Source</span>
                      <span>Citations</span>
                    </div>
                    {includedPapers.map((paper) => (
                      <div className={styles.tableRow} key={paper.id}>
                        <Tooltip title={paper.title}>
                          <span className={styles.studyTitle}>{paper.title}</span>
                        </Tooltip>
                        <Tag color="blue" style={{ fontSize: 10 }}>
                          {inferStudyType(paper)}
                        </Tag>
                        <span className={styles.cellText}>{paper.year || '–'}</span>
                        <Tag
                          color={paper.source === 'PubMed' ? 'blue' : 'green'}
                          style={{ fontSize: 10 }}
                        >
                          {paper.source}
                        </Tag>
                        <span className={styles.cellText}>
                          {paper.citations ? paper.citations.toLocaleString() : '–'}
                        </span>
                      </div>
                    ))}
                  </div>
                </Flexbox>

                {/* GRADE Assessment */}
                <Flexbox gap={8}>
                  <span className={styles.sectionTitle}>⭐ GRADE Quality Assessment</span>
                  <div className={styles.gradeCard}>
                    <Flexbox gap={4}>
                      {GRADE_DOMAINS.map((domain) => (
                        <div className={styles.gradeDomain} key={domain.key}>
                          <Flexbox gap={2}>
                            <span className={styles.domainLabel}>{domain.label}</span>
                            <span className={styles.domainDesc}>{domain.desc}</span>
                          </Flexbox>
                          <Tag color="green" style={{ fontSize: 10 }}>
                            No concerns
                          </Tag>
                        </div>
                      ))}
                    </Flexbox>
                    <Flexbox
                      align={'center'}
                      gap={12}
                      horizontal
                      justify={'space-between'}
                      style={{ borderTop: '2px solid', marginTop: 12, paddingTop: 12 }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 700 }}>Overall GRADE</span>
                      <span
                        className={styles.gradeBadge}
                        style={{
                          background: gradeConfig.color + '20',
                          color: gradeConfig.color,
                          fontSize: 14,
                          padding: '4px 16px',
                        }}
                      >
                        {gradeConfig.label}
                      </span>
                    </Flexbox>
                  </div>
                </Flexbox>

                {/* Phase Navigation */}
                <Flexbox gap={8} horizontal justify={'space-between'}>
                  <Button onClick={() => setActivePhase('screening')} size={'small'}>
                    ← Back to Screening
                  </Button>
                  <Button onClick={() => setActivePhase('writing')} size={'small'} type={'primary'}>
                    → Proceed to Writing
                  </Button>
                </Flexbox>
              </Flexbox>
            ),
            key: 'evidence',
            label: '📊 Bằng chứng & PRISMA',
          },
          {
            children: <StatTestAdvisor />,
            key: 'statadvisor',
            label: '🧮 Tư vấn Kiểm định',
          },
          {
            children: <InteractiveSimulators />,
            key: 'simulators',
            label: '📈 Simulators',
          },
          {
            children: <DataAnalyzer />,
            key: 'data',
            label: '📊 Phân tích dữ liệu',
          },
          {
            children: <LearningModules />,
            key: 'learning',
            label: '🧠 Ôn tập',
          },
          {
            children: <KnowledgeBase />,
            key: 'kb',
            label: '📚 Bách khoa',
          },
          {
            children: <RiskOfBias />,
            key: 'rob',
            label: '⚖️ RoB 2',
          },
          {
            children: <ForestPlot />,
            key: 'forestplot',
            label: '📈 Forest Plot',
          },
          {
            children: <ConsortStrobe />,
            key: 'consort',
            label: '📋 CONSORT/STROBE',
          },
          {
            children: <DoiResolver />,
            key: 'doi',
            label: '🔗 DOI Resolver',
          },
          {
            children: <ProsperoHelper />,
            key: 'prospero',
            label: '📝 PROSPERO',
          },
          {
            children: <CitationNetwork />,
            key: 'citationnet',
            label: '🕸️ Citation Network',
          },
          {
            children: <ImpactFactor />,
            key: 'impact',
            label: '📊 Impact Factor',
          },
          {
            children: <JournalRecommender />,
            key: 'journals',
            label: '📚 Journal Recommender',
          },
          {
            children: <ManuscriptTimeline />,
            key: 'timeline',
            label: '📅 Timeline',
          },
          {
            children: <PowerCalculator />,
            key: 'power',
            label: '🔬 Power Calculator',
          },
          {
            children: <PeerReviewSim />,
            key: 'peerreview',
            label: '🎭 Peer Review',
          },
          {
            children: <RisImporter />,
            key: 'import',
            label: '📎 Import Refs',
          },
          {
            children: <DeduplicationEngine />,
            key: 'dedup',
            label: '♻️ Dedup',
          },
          {
            children: <GradeSoF />,
            key: 'grade',
            label: '🏆 GRADE SoF',
          },
          {
            children: <NntCalculator />,
            key: 'nnt',
            label: '🏥 NNT/NNH',
          },
          {
            children: <SubgroupAnalysis />,
            key: 'subgroup',
            label: '📊 Subgroup',
          },
          {
            children: <PublicationBias />,
            key: 'pubbias',
            label: '🔎 Pub Bias',
          },
          {
            children: <DataExtractionForm />,
            key: 'extraction',
            label: '📋 Data Extract',
          },
          {
            children: <EvidenceSummarizer />,
            key: 'aisummary',
            label: '🧠 AI Synthesis',
          },
          {
            children: <RevManExport />,
            key: 'revman',
            label: '📦 RevMan',
          },
          {
            children: <AiRobFiller />,
            key: 'airob',
            label: '🤖 AI RoB',
          },
          {
            children: <MetaRegression />,
            key: 'metareg',
            label: '📈 Meta-Reg',
          },
          {
            children: <BibExport />,
            key: 'bibexport',
            label: '📤 BibTeX/RIS',
          },
          {
            children: <KappaCalculator />,
            key: 'kappa',
            label: '👥 Kappa',
          },
          {
            children: <ManuscriptReviewer />,
            key: 'manuscript-reviewer',
            label: '🤖 Manuscript Review',
          },
        ]}
        size={'small'}
      />
    </Flexbox>
  );
});

AnalysisPhase.displayName = 'AnalysisPhase';

export default AnalysisPhase;
