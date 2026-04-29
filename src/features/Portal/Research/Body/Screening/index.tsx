'use client';

import { Button, Tag } from '@lobehub/ui';
import { Alert, Select, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { Bot, CheckCircle, ChevronLeft, Loader2, Sparkles, XCircle } from 'lucide-react';
import React, { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { type ScreeningDecision, useResearchStore } from '@/store/research';
import { MEDICAL_SAFETY_PREFIX } from '@/utils/research/safetyPrompt';

// ── AI Screening helper ────────────────────────────────────────────────────
type AIVerdict = { decision: 'excluded' | 'included'; paperId: string; reason: string };

// Phase 1.5.3 (Audit #2) — surface fallback to caller so the UI can warn the
// user that AI screening was unavailable and they're seeing keyword-only
// decisions. Without this, users don't know quality silently degraded.
interface AIScreenResult {
  fallbackReason?: string;
  usedFallback: boolean;
  verdicts: AIVerdict[];
}

const aiScreenBatch = async (
  papers: Array<{ abstract?: string; id: string; title: string }>,
  pico: { comparison: string; intervention: string; outcome: string; population: string } | null,
  query: string,
): Promise<AIScreenResult> => {
  // Build a concise screener prompt
  const picoTxt = pico
    ? `PICO: P=${pico.population}, I=${pico.intervention}, C=${pico.comparison}, O=${pico.outcome}`
    : `Research question: ${query}`;

  const papersList = papers
    .map(
      (p, i) =>
        `[${i + 1}] ID:${p.id}\nTitle: ${p.title}\nAbstract: ${p.abstract ? p.abstract.slice(0, 300) : 'N/A'}`,
    )
    .join('\n---\n');

  const prompt = [
    `You are a systematic review assistant. Screen these papers for inclusion.`,
    `${picoTxt}`,
    `For each paper, respond ONLY with a JSON array (no markdown fences) like:`,
    `[{"id":"...","decision":"included"|"excluded","reason":"1 short phrase"}]`,
    `Papers:\n${papersList}`,
  ].join('\n');

  try {
    const res = await fetch('/api/research/ai-summary', {
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        // Phase 1.5.3 — apply shared medical safety framing so Gemini Flash
        // does not refuse with a "stop" token when paper abstracts mention
        // suicidality / mortality / depression. See safetyPrompt.ts.
        prompt: MEDICAL_SAFETY_PREFIX + prompt,
        stream: false,
      }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    const text: string = data?.text ?? '';
    const parsed = JSON.parse(text.replaceAll(/```[\s\w]*/g, '').trim()) as AIVerdict[];
    return { usedFallback: false, verdicts: parsed };
  } catch (err) {
    const fallbackReason = err instanceof Error ? err.message : String(err);

    // Phase 1.5.3 (Audit #2) — track frequency of AI screening failures.
    // Without this we can't tell if 1% of users hit it or 50%, which gates
    // any Phase 2 work on screening quality.
    try {
      (window as any).posthog?.capture('screening_fallback_to_keyword', {
        error: fallbackReason.slice(0, 200),
        paper_count: papers.length,
        surface: 'research_mode',
      });
    } catch {
      /* posthog not loaded */
    }

    // Fallback: AI not available — return heuristic decisions based on keywords
    const verdicts = papers.map((p) => {
      const titleLower = (p.title + (p.abstract ?? '')).toLowerCase();
      const queryWords = query
        .toLowerCase()
        .split(' ')
        .filter((w) => w.length > 4);
      const matches = queryWords.filter((w) => titleLower.includes(w)).length;
      const score = queryWords.length > 0 ? matches / queryWords.length : 0;
      return {
        decision: (score >= 0.3 ? 'included' : 'excluded') as 'excluded' | 'included',
        paperId: p.id,
        reason: score >= 0.3 ? 'Keyword match ≥30%' : 'Low keyword relevance',
      };
    });
    return { fallbackReason, usedFallback: true, verdicts };
  }
};

const useStyles = createStyles(({ css, token }) => ({
  actionBtn: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 10px;
    border-radius: 6px;

    font-size: 11px;
    font-weight: 600;

    transition: all 0.15s ease;
  `,
  container: css`
    width: 100%;
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
  excludeBtn: css`
    color: ${token.colorError};
    background: ${token.colorErrorBg};

    &:hover {
      background: ${token.colorErrorBgHover};
    }
  `,
  includeBtn: css`
    color: ${token.colorSuccess};
    background: ${token.colorSuccessBg};

    &:hover {
      background: ${token.colorSuccessBgHover};
    }
  `,
  paperAbstract: css`
    font-size: 11px;
    line-height: 1.5;
    color: ${token.colorTextTertiary};
  `,
  paperAbstractToggle: css`
    cursor: pointer;
    font-size: 10px;
    font-weight: 500;
    color: ${token.colorPrimary};

    &:hover {
      text-decoration: underline;
    }
  `,
  paperCard: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    transition: all 0.2s ease;
  `,
  paperExcluded: css`
    border-color: ${token.colorErrorBorder};
    background: ${token.colorErrorBg};
  `,
  paperIncluded: css`
    border-color: ${token.colorSuccessBorder};
    background: ${token.colorSuccessBg};
  `,
  paperMeta: css`
    font-size: 11px;
    color: ${token.colorTextSecondary};
  `,
  paperPending: css`
    background: ${token.colorFillQuaternary};
  `,
  paperTitle: css`
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    color: ${token.colorText};
  `,
  statItem: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 13px;
    font-weight: 600;
  `,
  statsBar: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  tab: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 14px;
    border-radius: ${token.borderRadius}px;

    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};

    transition: all 0.2s;

    &:hover {
      color: ${token.colorText};
    }
  `,
  tabActive: css`
    font-weight: 600;
    color: ${token.colorText};
    background: ${token.colorBgElevated};
    box-shadow: 0 1px 3px ${token.colorFillSecondary};
  `,
  tabBar: css`
    display: flex;
    gap: 4px;

    padding: 4px;
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
}));

type ScreeningTab = 'all' | 'excluded' | 'included' | 'pending';

const ScreeningPhase = memo(() => {
  const { styles, cx } = useStyles();
  const [tab, setTab] = useState<ScreeningTab>('all');

  const papers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const screenPaper = useResearchStore((s) => s.screenPaper);
  const getScreeningStats = useResearchStore((s) => s.getScreeningStats);
  const includeAllPapers = useResearchStore((s) => s.includeAllPapers);
  const resetScreening = useResearchStore((s) => s.resetScreening);
  const setActivePhase = useResearchStore((s) => s.setActivePhase);
  const pico = useResearchStore((s) => s.pico);
  const searchQuery = useResearchStore((s) => s.searchQuery);

  const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set());
  const [pendingExclude, setPendingExclude] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiScreenedCount, setAiScreenedCount] = useState(0);
  // Phase 1.5.3 (Audit #2) — track when AI screening fell back to keyword
  // matching so we can show a warning Alert + Retry instead of silently
  // marking papers via low-quality regex.
  const [aiUsedFallback, setAiUsedFallback] = useState(false);
  const [aiFallbackReason, setAiFallbackReason] = useState('');

  const EXCLUSION_REASONS = [
    { label: 'Wrong population', value: 'Wrong population' },
    { label: 'Wrong intervention', value: 'Wrong intervention' },
    { label: 'Wrong outcome', value: 'Wrong outcome' },
    { label: 'Wrong study type', value: 'Wrong study type' },
    { label: 'Irrelevant topic', value: 'Irrelevant topic' },
    { label: 'Duplicate', value: 'Duplicate' },
    { label: 'Not enough data', value: 'Not enough data' },
    { label: 'Animal study', value: 'Animal study' },
    { label: 'Non-English', value: 'Non-English' },
  ];

  const handleExcludeClick = (paperId: string, currentDecision: ScreeningDecision) => {
    if (currentDecision === 'excluded') {
      // Toggle back to pending
      screenPaper(paperId, 'pending');
      setPendingExclude(null);
    } else {
      setPendingExclude(paperId);
    }
  };

  const handleReasonSelect = (paperId: string, reason: string) => {
    screenPaper(paperId, 'excluded', reason);
    setPendingExclude(null);
  };

  const toggleAbstract = useCallback((paperId: string) => {
    setExpandedAbstracts((prev) => {
      const next = new Set(prev);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return next;
    });
  }, []);

  // ── AI Auto-Screen ───────────────────────────────────────────────────
  const handleAIScreen = useCallback(async () => {
    const pendingPapers = papers.filter(
      (p) => !screeningDecisions[p.id] || screeningDecisions[p.id]?.decision === 'pending',
    );
    if (pendingPapers.length === 0) return;
    setAiLoading(true);
    // Clear any prior fallback warning so a successful retry hides the Alert.
    setAiUsedFallback(false);
    setAiFallbackReason('');
    try {
      const result = await aiScreenBatch(pendingPapers, pico, searchQuery);
      let count = 0;
      for (const v of result.verdicts) {
        const id = v.paperId ?? (v as { id?: string }).id;
        if (id) {
          screenPaper(id, v.decision, v.reason);
          count++;
        }
      }
      setAiScreenedCount(count);
      if (result.usedFallback) {
        setAiUsedFallback(true);
        setAiFallbackReason(result.fallbackReason ?? '');
      }
    } finally {
      setAiLoading(false);
    }
  }, [papers, screeningDecisions, pico, searchQuery, screenPaper]);

  const stats = getScreeningStats();

  const filteredPapers = useMemo(() => {
    switch (tab) {
      case 'excluded': {
        return papers.filter((p) => screeningDecisions[p.id]?.decision === 'excluded');
      }
      case 'included': {
        return papers.filter((p) => screeningDecisions[p.id]?.decision === 'included');
      }
      case 'pending': {
        return papers.filter(
          (p) => !screeningDecisions[p.id] || screeningDecisions[p.id]?.decision === 'pending',
        );
      }
      default: {
        return papers;
      }
    }
  }, [papers, screeningDecisions, tab]);

  const getDecision = (paperId: string): ScreeningDecision => {
    return screeningDecisions[paperId]?.decision || 'pending';
  };

  const getCardClass = (paperId: string) => {
    const decision = getDecision(paperId);
    if (decision === 'included') return cx(styles.paperCard, styles.paperIncluded);
    if (decision === 'excluded') return cx(styles.paperCard, styles.paperExcluded);
    return cx(styles.paperCard, styles.paperPending);
  };

  if (papers.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span style={{ fontSize: 48 }}>📋</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>No papers to screen</span>
        <span style={{ fontSize: 13 }}>
          Go back to Discovery phase and search for papers first.
        </span>
        <Button onClick={() => setActivePhase('discovery')} size={'small'} type={'primary'}>
          <ChevronLeft size={14} /> Back to Discovery
        </Button>
      </div>
    );
  }

  return (
    <Flexbox className={styles.container} gap={12}>
      {/* PRISMA Stats Bar */}
      <div className={styles.statsBar}>
        <Flexbox gap={16} horizontal wrap={'wrap'}>
          <span className={styles.statItem}>
            📄 Total: <strong>{stats.total}</strong>
          </span>
          <span className={styles.statItem} style={{ color: '#52c41a' }}>
            ✅ Included: <strong>{stats.included}</strong>
          </span>
          <span className={styles.statItem} style={{ color: '#ff4d4f' }}>
            ❌ Excluded: <strong>{stats.excluded}</strong>
          </span>
          <span className={styles.statItem} style={{ color: '#faad14' }}>
            ⏳ Pending: <strong>{stats.pending}</strong>
          </span>
        </Flexbox>
      </div>

      {/* Phase 1.5.3 — fallback warning when AI screening was unavailable */}
      {aiUsedFallback && (
        <Alert
          action={
            <Button onClick={handleAIScreen} size={'small'} type={'primary'}>
              Thử lại AI
            </Button>
          }
          closable
          description={
            <span>
              Hệ thống đã dùng phương pháp lọc theo từ khóa thay thế. Kết quả có thể kém chính xác
              hơn AI screening đầy đủ. Hãy nhấn &ldquo;Thử lại&rdquo; để gọi lại AI.
              {aiFallbackReason && (
                <span style={{ display: 'block', fontSize: 11, marginTop: 4, opacity: 0.65 }}>
                  Lỗi: {aiFallbackReason}
                </span>
              )}
            </span>
          }
          message="AI screening tạm thời không khả dụng"
          onClose={() => setAiUsedFallback(false)}
          showIcon
          type="warning"
        />
      )}

      {/* Quick Actions */}
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        {/* AI Screen Button — MED-39 */}
        <Tooltip
          title={
            aiLoading
              ? 'AI đang sàng lọc...'
              : 'AI tự động phân tích abstract và gợi ý include/exclude'
          }
        >
          <Button
            icon={
              aiLoading ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />
            }
            loading={aiLoading}
            onClick={handleAIScreen}
            size={'small'}
            style={{
              background: 'linear-gradient(135deg, rgba(114,46,209,0.15), rgba(22,119,255,0.1))',
              borderColor: 'rgba(114,46,209,0.4)',
              color: '#722ed1',
              fontWeight: 600,
            }}
          >
            <Bot size={13} />
            AI Sàng lọc tự động
            {aiScreenedCount > 0 && (
              <Tag bordered={false} style={{ fontSize: 9, marginLeft: 4 }}>
                {aiScreenedCount} đã xử lý
              </Tag>
            )}
          </Button>
        </Tooltip>
        <Button onClick={includeAllPapers} size={'small'}>
          ✅ Include All
        </Button>
        <Button onClick={resetScreening} size={'small'}>
          🔄 Reset
        </Button>
        {stats.included > 0 && (
          <Button onClick={() => setActivePhase('analysis')} size={'small'} type={'primary'}>
            → Analysis ({stats.included} papers)
          </Button>
        )}
      </Flexbox>

      {/* Tab Bar */}
      <div className={styles.tabBar}>
        {[
          { count: papers.length, key: 'all' as const, label: 'All' },
          { count: stats.pending, key: 'pending' as const, label: 'Pending' },
          { count: stats.included, key: 'included' as const, label: 'Included' },
          { count: stats.excluded, key: 'excluded' as const, label: 'Excluded' },
        ].map((t) => (
          <span
            className={cx(styles.tab, tab === t.key && styles.tabActive)}
            key={t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({t.count})
          </span>
        ))}
      </div>

      {/* Paper Cards */}
      {filteredPapers.map((paper) => {
        const decision = getDecision(paper.id);
        return (
          <div className={getCardClass(paper.id)} key={paper.id}>
            <Flexbox gap={8}>
              <Flexbox align={'flex-start'} gap={8} horizontal justify={'space-between'}>
                <span className={styles.paperTitle}>{paper.title}</span>
                <Flexbox gap={4} horizontal style={{ flexShrink: 0 }}>
                  <span
                    className={cx(styles.actionBtn, styles.includeBtn)}
                    onClick={() => {
                      screenPaper(paper.id, decision === 'included' ? 'pending' : 'included');
                      setPendingExclude(null);
                    }}
                    style={{ opacity: decision === 'included' ? 1 : 0.6 }}
                  >
                    <CheckCircle size={12} />
                    {decision === 'included' ? '✓' : 'Include'}
                  </span>
                  {pendingExclude === paper.id ? (
                    <Select
                      autoFocus
                      onBlur={() => setPendingExclude(null)}
                      onChange={(reason) => handleReasonSelect(paper.id, reason)}
                      options={EXCLUSION_REASONS}
                      placeholder="Lý do loại..."
                      size="small"
                      style={{ fontSize: 11, minWidth: 140 }}
                    />
                  ) : (
                    <span
                      className={cx(styles.actionBtn, styles.excludeBtn)}
                      onClick={() => handleExcludeClick(paper.id, decision)}
                      style={{ opacity: decision === 'excluded' ? 1 : 0.6 }}
                    >
                      <XCircle size={12} />
                      {decision === 'excluded' ? '✗' : 'Exclude'}
                    </span>
                  )}
                </Flexbox>
              </Flexbox>
              <span className={styles.paperMeta}>{paper.authors}</span>
              {/* Abstract */}
              {paper.abstract && (
                <Flexbox gap={2}>
                  <span className={styles.paperAbstract}>
                    {expandedAbstracts.has(paper.id)
                      ? paper.abstract
                      : paper.abstract.length > 150
                        ? `${paper.abstract.slice(0, 150)}...`
                        : paper.abstract}
                  </span>
                  {paper.abstract.length > 150 && (
                    <span
                      className={styles.paperAbstractToggle}
                      onClick={() => toggleAbstract(paper.id)}
                    >
                      {expandedAbstracts.has(paper.id) ? '▲ Thu gọn' : '▼ Xem abstract'}
                    </span>
                  )}
                </Flexbox>
              )}
              <Flexbox align={'center'} gap={6} horizontal wrap={'wrap'}>
                <Tag
                  color={
                    paper.source === 'PubMed'
                      ? 'blue'
                      : paper.source === 'ArXiv'
                        ? 'purple'
                        : 'green'
                  }
                  style={{ fontSize: 10 }}
                >
                  {paper.source}
                </Tag>
                {paper.journal && <span className={styles.paperMeta}>{paper.journal}</span>}
                {paper.year > 0 && <span className={styles.paperMeta}>· {paper.year}</span>}
                {paper.citations !== undefined && paper.citations > 0 && (
                  <span className={styles.paperMeta}>📝 {paper.citations.toLocaleString()}</span>
                )}
                {screeningDecisions[paper.id]?.reason && (
                  <Tag color="orange" style={{ fontSize: 10 }}>
                    {screeningDecisions[paper.id].reason}
                  </Tag>
                )}
              </Flexbox>
            </Flexbox>
          </div>
        );
      })}
    </Flexbox>
  );
});

ScreeningPhase.displayName = 'ScreeningPhase';

export default ScreeningPhase;
