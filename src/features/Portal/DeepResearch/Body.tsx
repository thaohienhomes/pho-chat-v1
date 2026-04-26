'use client';

import { Markdown } from '@lobehub/ui';
import { Button, Dropdown, Input, Select, Spin, Tag, Tooltip, message, notification } from 'antd';
import { createStyles } from 'antd-style';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  StopCircle,
  Trash2,
  X,
} from 'lucide-react';
import { marked } from 'marked';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useChatStore } from '@/store/chat';
import { buildSearchQuery } from '@/utils/research/buildSearchQuery';
import { MEDICAL_SAFETY_PREFIX } from '@/utils/research/safetyPrompt';

const { TextArea } = Input;

/* ────────────────────────── types ────────────────────────── */

type Phase = 'input' | 'clarify' | 'research' | 'outline' | 'article' | 'done';

interface AgentResult {
  content: string;
  name: string;
  status: 'idle' | 'running' | 'done' | 'error';
}

interface OutlineItem {
  children?: OutlineItem[];
  title: string;
}

interface HistoryItem {
  article: string;
  date: string;
  id: string;
  lang: string;
  model: string;
  question: string;
}

interface PubMedPaper {
  abstract: string;
  authors: string;
  citationCount?: number;
  journal: string;
  pmid: string;
  source?: 'pubmed' | 'semantic_scholar';
  title: string;
  year: string;
}

interface CitationResult {
  citation: string;
  pmid?: string;
  status: 'verified' | 'unverified' | 'checking';
  title?: string;
}

interface GradeRow {
  imprecision: string;
  inconsistency: string;
  indirectness: string;
  outcome: string;
  overallQuality: 'High' | 'Moderate' | 'Low' | 'Very Low';
  riskOfBias: string;
  studyDesign: string;
}

const GRADE_QUALITY_COLORS: Record<string, { bg: string; emoji: string; text: string }> = {
  'High': { bg: 'rgba(34,197,94,0.15)', emoji: '⬆️', text: '#22c55e' },
  'Low': { bg: 'rgba(249,115,22,0.15)', emoji: '⬇️', text: '#f97316' },
  'Moderate': { bg: 'rgba(234,179,8,0.15)', emoji: '➡️', text: '#eab308' },
  'Very Low': { bg: 'rgba(239,68,68,0.15)', emoji: '⬇️⬇️', text: '#ef4444' },
};

interface NetworkRef {
  authors: string;
  citationCount: number;
  paperId: string;
  title: string;
  url: string;
  year: number | null;
}

const HISTORY_KEY = 'pho-deep-research-history';

const LANGUAGES = [
  { label: '🇺🇸 English', value: 'en' },
  { label: '🇻🇳 Tiếng Việt', value: 'vi' },
];

const TEMPLATES = [
  {
    cat: '❤️ Tim mạch',
    questions: [
      'Efficacy of SGLT2 inhibitors vs GLP-1 agonists for heart failure with preserved ejection fraction',
      'Direct oral anticoagulants vs warfarin in patients with atrial fibrillation and chronic kidney disease',
    ],
  },
  {
    cat: '🧠 Thần kinh',
    questions: [
      'Anti-amyloid monoclonal antibodies (lecanemab, donanemab) for early Alzheimer disease',
      'Tenecteplase vs alteplase for acute ischemic stroke thrombolysis',
    ],
  },
  {
    cat: '🩸 Ung bướu',
    questions: [
      'Immune checkpoint inhibitors combined with chemotherapy for first-line treatment of advanced NSCLC',
      'CAR-T cell therapy vs bispecific antibodies for relapsed/refractory DLBCL',
    ],
  },
  {
    cat: '🦠 Nhiễm',
    questions: [
      'Long-acting injectable cabotegravir/rilpivirine vs daily oral ART for HIV-1 maintenance',
      'Nirmatrelvir/ritonavir (Paxlovid) effectiveness in vaccinated patients with COVID-19',
    ],
  },
];

/* ────────────────────────── agents ────────────────────────── */

const AGENTS = [
  {
    desc: 'Tìm kiếm RCTs, meta-analyses, cohort studies liên quan',
    emoji: '🔬',
    name: 'Clinical Researcher',
  },
  {
    desc: 'Đánh giá chất lượng nghiên cứu, risk of bias, study design',
    emoji: '📐',
    name: 'Methodologist',
  },
  {
    desc: 'Đánh giá ứng dụng thực tế, hiệu quả lâm sàng, dose-response',
    emoji: '👨‍⚕️',
    name: 'Clinician',
  },
  {
    desc: 'Tác dụng phụ, chất lượng cuộc sống, tuân thủ điều trị',
    emoji: '🧑‍🤝‍🧑',
    name: 'Patient Advocate',
  },
];

const MODELS = [
  { label: 'Gemini 2.5 Flash (fast)', value: 'gemini-2.5-flash' },
  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
  { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
  { label: 'GPT-4o', value: 'gpt-4o' },
  { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
];

/* ────────────────────────── styles ────────────────────────── */

const useStyles = createStyles(({ css, token }) => ({
  agentCard: css`
    cursor: pointer;

    padding: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};

    transition: all 0.3s;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  agentContent: css`
    overflow-y: auto;

    max-height: 200px;
    margin-block-start: 8px;
    padding: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;

    font-size: 12px;
    line-height: 1.6;

    background: ${token.colorBgContainer};
  `,
  agentDone: css`
    border-color: ${token.colorSuccess};
  `,
  agentError: css`
    border-color: ${token.colorError};
  `,
  agentRunning: css`
    border-color: ${token.colorPrimary};
    box-shadow: 0 0 8px ${token.colorPrimaryBg};
  `,
  article: css`
    overflow-y: auto;

    max-height: 60vh;
    padding: 16px;
    border-radius: ${token.borderRadiusLG}px;

    font-size: 14px;
    line-height: 1.7;
    white-space: pre-wrap;

    background: ${token.colorFillQuaternary};
  `,
  container: css`
    overflow-y: auto;
    width: 100%;
    height: 100%;
    padding: 16px;
  `,
  header: css`
    font-size: 18px;
    font-weight: 700;

    background: linear-gradient(135deg, #667eea, #764ba2);
    background-clip: text;

    -webkit-text-fill-color: transparent;
  `,
  historyItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${token.borderRadius}px;

    font-size: 12px;

    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
  historyLabel: css`
    overflow: hidden;
    flex: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  outlineItem: css`
    cursor: pointer;
    padding-block: 6px;
    padding-inline: 12px;
    border-radius: ${token.borderRadius}px;

    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
  phaseActive: css`
    padding-block: 3px;
    padding-inline: 10px;
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: 16px;

    font-weight: 600;
    color: ${token.colorPrimary};

    background: ${token.colorPrimaryBg};
  `,
  phaseBar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${token.borderRadiusLG}px;

    font-size: 11px;

    background: ${token.colorFillQuaternary};
  `,
  phaseDone: css`
    padding-block: 3px;
    padding-inline: 10px;
    border-radius: 16px;

    color: ${token.colorSuccess};

    background: ${token.colorSuccessBg};
  `,
  phaseItem: css`
    padding-block: 3px;
    padding-inline: 10px;
    border-radius: 16px;
    color: ${token.colorTextQuaternary};
  `,
  progressLine: css`
    padding-block: 2px;
    padding-inline: 0;
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  subtitle: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
}));

/* ────────────────────────── helpers ────────────────────────── */

/* ── Concurrency limiter for AI calls (max 2 parallel to avoid 429) ── */
const aiSemaphore = { current: 0, max: 2, queue: [] as (() => void)[] };

function acquireSemaphore(): Promise<void> {
  if (aiSemaphore.current < aiSemaphore.max) {
    aiSemaphore.current++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    aiSemaphore.queue.push(() => {
      aiSemaphore.current++;
      resolve();
    });
  });
}

function releaseSemaphore(): void {
  aiSemaphore.current--;
  const next = aiSemaphore.queue.shift();
  if (next) next();
}

async function callAI(model: string, prompt: string, label = 'unknown'): Promise<string> {
  await acquireSemaphore();
  const MAX_RETRIES = 3;

  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort('Timeout: request took too long'),
        300_000,
      );

      try {
        const res = await fetch('/api/research/ai-summary', {
          body: JSON.stringify({ model, prompt }),
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        });

        if (res.status === 429) {
          clearTimeout(timeoutId);
          const delayMs = Math.min(2000 * Math.pow(2, attempt), 8000);
          console.warn(
            `[DeepResearch] 429 rate limit for ${label}, retry ${attempt + 1} in ${delayMs}ms`,
          );
          (window as any).posthog?.capture('ai_rate_limit_429', {
            attempt,
            delay_ms: delayMs,
            label,
            surface: 'deep_research',
          });
          await new Promise<void>((r) => {
            setTimeout(r, delayMs);
          });
          continue;
        }

        if (!res.ok) {
          clearTimeout(timeoutId);
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        clearTimeout(timeoutId);
        console.log('[DeepResearch] callAI response:', {
          label,
          length: data.text?.length,
          model: data.model,
          provider: data.provider,
        });
        return data.text || '';
      } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
          throw new Error('Request timed out — server may be overloaded. Please try again.');
        }
        throw e;
      }
    }
    throw new Error(`Rate limited after ${MAX_RETRIES} retries`);
  } finally {
    releaseSemaphore();
  }
}

async function callAIStream(
  model: string,
  prompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort('Timeout: article generation took too long'),
    300_000,
  ); // 5 min to match API maxDuration

  // Forward external abort signal
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const res = await fetch('/api/research/ai-summary', {
      body: JSON.stringify({ model, prompt, stream: true }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No stream body');
    const decoder = new TextDecoder();
    let fullContent = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const raw = trimmed.slice(6);
        if (raw === '[DONE]') continue;
        try {
          const delta = JSON.parse(raw);
          let text = '';
          if (typeof delta === 'string') {
            text = delta;
          } else if (delta && typeof delta === 'object') {
            text = delta?.choices?.[0]?.delta?.content ?? delta?.text ?? delta?.content ?? '';
          }
          if (text) {
            fullContent += text;
            onChunk(fullContent);
          }
        } catch {
          /* skip unparseable */
        }
      }
    }

    // Phase 1.5.3 (Audit #7) — strip chat-template artifacts that occasionally
    // leak through streaming, matching the buildSearchQuery cleanup from Phase
    // 1.5.1. Symptom: ".stop" suffix at the end of Key Takeaways or trailing
    // tokens like <|im_end|>, <|endoftext|>, </stop>. The (\w)stop$ rule only
    // strips when "stop" has a word char immediately before and is at the very
    // end — so "non-stop" / "stop bleeding" mid-content are left alone.
    const cleaned = fullContent
      .replace(/(<\|?im_end\|?>|<\|?endoftext\|?>|<\/?stop>)\s*$/i, '')
      .replace(/(\w)stop\s*$/i, '$1')
      .trimEnd();
    console.log('[DeepResearch] callAIStream complete:', {
      length: cleaned.length,
      stripped: fullContent.length - cleaned.length,
    });
    return cleaned;
  } catch (e: any) {
    // Convert AbortError to friendly message
    if (e.name === 'AbortError') {
      throw new Error('Quá thời gian chờ — server có thể đang quá tải. Vui lòng thử lại.');
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function searchPubMed(query: string, maxResults = 8): Promise<PubMedPaper[]> {
  try {
    const res = await fetch('/api/research/pubmed-search', {
      body: JSON.stringify({ maxResults, query }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.papers || [];
  } catch (error) {
    console.warn('[DeepResearch] PubMed search failed, continuing without literature');
    // Phase 1.5.3 (Audit #1) — surface API outages without relying on user complaints.
    try {
      const errMsg = error instanceof Error ? error.message : String(error);
      (window as any).posthog?.capture('search_source_failed', {
        error: errMsg.slice(0, 200),
        query: query.slice(0, 100),
        source: 'PubMed',
        surface: 'deep_research',
      });
    } catch {
      /* posthog not loaded */
    }
    return [];
  }
}

async function searchSemanticScholar(query: string, limit = 10): Promise<PubMedPaper[]> {
  try {
    const res = await fetch(
      `/api/research/semantic-scholar?q=${encodeURIComponent(query)}&limit=${limit}`,
      {
        credentials: 'include',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.papers || []).map((p: any) => ({
      abstract: p.abstract || '',
      authors: p.authors || '',
      citationCount: p.citationCount || 0,
      journal: '',
      pmid: p.pmid || p.paperId || '',
      source: 'semantic_scholar' as const,
      title: p.title || '',
      year: p.year || '',
    }));
  } catch (error) {
    console.warn('[DeepResearch] Semantic Scholar search failed');
    // Phase 1.5.3 (Audit #1) — surface API outages without relying on user complaints.
    try {
      const errMsg = error instanceof Error ? error.message : String(error);
      (window as any).posthog?.capture('search_source_failed', {
        error: errMsg.slice(0, 200),
        query: query.slice(0, 100),
        source: 'SemanticScholar',
        surface: 'deep_research',
      });
    } catch {
      /* posthog not loaded */
    }
    return [];
  }
}

function deduplicatePapers(papers: PubMedPaper[]): PubMedPaper[] {
  const seen = new Set<string>();
  return papers.filter((p) => {
    const key = p.title
      .toLowerCase()
      .replaceAll(/[^\da-z]/g, '')
      .slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function verifyCitationsAgainstPubMed(article: string): Promise<CitationResult[]> {
  // Extract citations in [Author, Year] format
  const citationRegex = /\[([A-Z][\sA-Za-zÀ-ỹ]+(?:et al\.?)?),?\s*(\d{4}[a-z]?)]/g;
  const found = new Map<string, string>();
  let match;
  while ((match = citationRegex.exec(article)) !== null) {
    const key = `${match[1].trim()}, ${match[2]}`;
    if (!found.has(key)) found.set(key, match[0]);
  }

  if (found.size === 0) return [];

  const results: CitationResult[] = [];
  // Verify each citation against PubMed
  for (const [key, raw] of found.entries()) {
    const [author, year] = key.split(', ');
    const searchQuery = `${author.replace(' et al.', '').replace(' et al', '')}[Author] AND ${year}[Date - Publication]`;
    try {
      const papers = await searchPubMed(searchQuery, 3);
      if (papers.length > 0) {
        results.push({
          citation: raw,
          pmid: papers[0].pmid,
          status: 'verified',
          title: papers[0].title,
        });
      } else {
        results.push({ citation: raw, status: 'unverified' });
      }
    } catch {
      results.push({ citation: raw, status: 'unverified' });
    }
  }
  return results;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/* ────────────────────────── component ────────────────────────── */

const DeepResearchBody = memo(() => {
  const { styles, cx } = useStyles();
  const [phase, setPhase] = useState<Phase>('input');
  const [question, setQuestion] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [clarifyQs, setClarifyQs] = useState<string[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<number, string>>({});
  const [agents, setAgents] = useState<AgentResult[]>(
    AGENTS.map((a) => ({ content: '', name: a.name, status: 'idle' })),
  );
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [article, setArticle] = useState('');
  const [outputLang, setOutputLang] = useState('en');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null);
  const [editingOutlineIdx, setEditingOutlineIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [refinePrompt, setRefinePrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pubmedPapers, setPubmedPapers] = useState<PubMedPaper[]>([]);
  const [citationResults, setCitationResults] = useState<CitationResult[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showAllPapers, setShowAllPapers] = useState(false);
  const [showPrisma, setShowPrisma] = useState(false);
  const [articleWaitLong, setArticleWaitLong] = useState(false);
  const [gradeData, setGradeData] = useState<GradeRow[]>([]);
  const [showGrade, setShowGrade] = useState(false);
  const [isGeneratingGrade, setIsGeneratingGrade] = useState(false);
  const [searchSources, setSearchSources] = useState<Set<string>>(
    new Set(['pubmed', 'semantic_scholar']),
  );
  const [noPapersFound, setNoPapersFound] = useState(false);
  const [showNetwork, setShowNetwork] = useState(false);
  const [networkData, setNetworkData] = useState<Record<string, NetworkRef[]>>({});
  const [expandedNetworkNode, setExpandedNetworkNode] = useState<string | null>(null);
  const [loadingNetwork, setLoadingNetwork] = useState<string | null>(null);

  // ── Research Idea Evaluator state ──
  const [evaluatorMode, setEvaluatorMode] = useState<
    'hidden' | 'pitch' | 'troubleshoot' | 'strategic'
  >('hidden');
  const [evaluatorStep, setEvaluatorStep] = useState(0);
  const [evaluatorInput, setEvaluatorInput] = useState('');
  const [evaluatorAnswers, setEvaluatorAnswers] = useState<string[]>([]);
  const [evaluatorResult, setEvaluatorResult] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);

  const abortRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const startResearchRef = useRef<(() => void) | undefined>(undefined);
  // Bug H fix — guard against the auto-trigger useEffect firing
  // startResearch multiple times (StrictMode double-invoke, parent
  // re-render reconciliation, race between phase change and agent state).
  // Reset to false when phase changes AWAY from 'research' so re-entry
  // (Reset → new question) still works.
  const hasAutoStartedRef = useRef(false);

  // Consume pendingResearchQuery from portal store (auto-fill from chat suggestion)
  const pendingQuery = useChatStore((s) => s.pendingResearchQuery);
  const clearPendingQuery = useChatStore((s) => s.clearPendingResearchQuery);
  useEffect(() => {
    if (pendingQuery && phase === 'input') {
      setQuestion(pendingQuery);
      clearPendingQuery();
    }
  }, [pendingQuery, phase]);

  // Elapsed timer
  useEffect(() => {
    if (!startTime) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(
      () => setElapsed(Math.floor((Date.now() - startTime) / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [startTime]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) setHistory(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, []);

  const PHASES_LIST: { key: Phase; label: string }[] = [
    { key: 'input', label: '📝 Câu hỏi' },
    { key: 'clarify', label: '❓ Làm rõ' },
    { key: 'research', label: '🔍 Nghiên cứu' },
    { key: 'outline', label: '📋 Dàn bài' },
    { key: 'article', label: '✍️ Viết bài' },
    { key: 'done', label: '✅ Hoàn thành' },
  ];

  const phaseIndex = PHASES_LIST.findIndex((p) => p.key === phase);

  /* ── Phase 1 → Clarify ── */
  const handleStart = useCallback(async () => {
    if (!question.trim()) return;
    setPhase('clarify');
    setProgressLines(['🤔 Đang phân tích câu hỏi nghiên cứu...']);

    (window as any).posthog?.capture('research_started', {
      model,
      question: question.slice(0, 200),
      surface: 'deep_research',
    });

    try {
      const prompt = `You are a medical research methodology expert. The user wants to write a literature review on the following clinical question:

"${question}"

Generate 3-4 clarifying questions to help scope the review. Each question should be concise and help define:
- Population/condition scope
- Intervention types to include
- Outcome measures of interest
- Time frame or study design preferences

Format: Return ONLY a JSON array of strings, each being one question. Example:
["Should the review focus only on RCTs, or include observational studies?", "What age group should be included?"]

Return ONLY the JSON array, no other text.`;

      const result = await callAI(model, prompt);
      console.log('[DeepResearch] Clarify raw result:', result.slice(0, 500));
      try {
        // Clean markdown code fences and extract JSON
        let cleaned = result.replaceAll('```json', '').replaceAll('```', '').trim();
        // Also try to extract JSON array from any surrounding text
        const jsonMatch = cleaned.match(/\[\s*"[\S\s]*]/);
        if (jsonMatch) cleaned = jsonMatch[0];
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setClarifyQs(parsed);
          setProgressLines((prev) => [...prev, '✅ Câu hỏi làm rõ đã được tạo']);
          return; // Stay in clarify phase
        }
      } catch (parseErr) {
        console.warn('[DeepResearch] Failed to parse clarify JSON:', parseErr);
      }
      // If we get here, parsing failed or empty — skip to research
      console.log('[DeepResearch] Skipping clarify phase, going to research directly');
      setClarifyQs([]);
      setPhase('research');
      setProgressLines((prev) => [
        ...prev,
        '⚠️ Bỏ qua giai đoạn làm rõ, bắt đầu nghiên cứu trực tiếp...',
      ]);
    } catch (e: any) {
      console.error('[DeepResearch] handleStart error:', e);
      message.error(`Lỗi: ${e.message}`);
      setPhase('input');
    }
  }, [question, model]);

  /* ── Phase 3 → Outline ── */
  const startOutline = useCallback(
    async (agentFindings: string) => {
      setPhase('outline');

      try {
        const prompt = `You are an academic writing expert specializing in medical literature reviews. Based on the following multi-perspective research findings, generate a structured outline for a comprehensive literature review.

Clinical Question: "${question}"

Research Findings:
${agentFindings.slice(0, 12_000)}

Generate a hierarchical outline with main sections and subsections. The outline should follow standard medical literature review structure:
1. Introduction & Background
2. Search Strategy & Methods
3. Results (organized by themes/outcomes)
4. Quality of Evidence (GRADE assessment)
5. Discussion
6. Clinical Implications
7. Conclusions

Format: Return ONLY a JSON array of objects with "title" and optional "children" array. Example:
[{"title": "1. Introduction", "children": [{"title": "1.1 Background"}, {"title": "1.2 Rationale"}]}, {"title": "2. Methods"}]

Return ONLY the JSON array.`;

        const result = await callAI(model, prompt);
        try {
          const cleaned = result
            .replaceAll('```json\n', '')
            .replaceAll('```\n', '')
            .replaceAll('```', '')
            .trim();
          const parsed = JSON.parse(cleaned);
          setOutline(Array.isArray(parsed) ? parsed : []);
          setExpandedSections(new Set(parsed.map((_: any, i: number) => i)));
        } catch {
          // Fallback outline
          setOutline([
            {
              children: [{ title: '1.1 Background' }, { title: '1.2 Rationale' }],
              title: '1. Introduction',
            },
            { title: '2. Search Strategy & Methods' },
            {
              children: [{ title: '3.1 Study Characteristics' }, { title: '3.2 Key Findings' }],
              title: '3. Results',
            },
            { title: '4. Quality of Evidence' },
            { title: '5. Discussion' },
            { title: '6. Clinical Implications' },
            { title: '7. Conclusions' },
          ]);
        }
        setProgressLines((prev) => [...prev, '✅ Dàn bài đã tạo xong']);
      } catch (e: any) {
        message.error(`Outline error: ${e.message}`);
      }
    },
    [question, model],
  );

  /* ── Run agents + outline (shared by happy-path and continue-without-literature) ── */
  const runAgentsAndOutline = useCallback(
    async (papers: PubMedPaper[], hasLiterature: boolean) => {
      if (abortRef.current) return;

      const litContext = hasLiterature
        ? `\n\n=== RETRIEVED LITERATURE FROM PUBMED ===\n${papers
            .slice(0, 6)
            .map(
              (p, i) =>
                `[${i + 1}] ${p.authors} (${p.year}). ${p.title}. ${p.journal}. PMID: ${p.pmid}\nAbstract: ${p.abstract.slice(0, 400)}`,
            )
            .join('\n\n')}\n=== END LITERATURE ===`
        : '';

      const clarifyContext =
        clarifyQs.length > 0
          ? `\n\nAdditional scope context from clarifying questions:\n${clarifyQs.map((q, i) => `Q: ${q}\nA: ${clarifyAnswers[i] || 'No specific preference'}`).join('\n')}`
          : '';

      // When no literature is available, harden the prompt to forbid fabricated citations.
      const citationGuard = hasLiterature
        ? `IMPORTANT: When citing studies, use ONLY real papers from the provided PubMed literature above. Use the format [Author, Year] and include the PMID when possible. Do NOT fabricate or hallucinate citations.`
        : `IMPORTANT: No literature was retrieved for this question. You MUST NOT cite specific studies, authors, journals, PMIDs, or DOIs. Use only general clinical knowledge and clearly label it as such (e.g., "general clinical practice suggests", "standard textbook teaching indicates"). Inventing citations is strictly prohibited.`;

      const agentPrompts = AGENTS.map((agent) => {
        const perspectiveMap: Record<string, string> = {
          'Clinical Researcher': `You are a clinical researcher conducting a literature search. Find and summarize key clinical studies (RCTs, systematic reviews, meta-analyses) relevant to this question. For each study found, provide: Author/Year, Study Design, Sample Size, Key Findings, and Limitations. Focus on the highest quality evidence available.`,
          'Clinician': `You are an experienced clinician evaluating the clinical applicability of research. Assess the practical implications of findings for this question. Consider: treatment protocols, dose-response relationships, patient selection criteria, monitoring requirements, clinical decision-making algorithms, and real-world effectiveness vs efficacy.`,
          'Methodologist': `You are a research methodologist reviewing the quality of evidence. For this question, assess: study design adequacy, risk of bias (using Cochrane RoB 2.0 or ROBINS-I frameworks), heterogeneity concerns, publication bias indicators, statistical methods used, and overall quality of evidence (using GRADE or similar framework).`,
          'Patient Advocate': `You are a patient advocate reviewing research from the patient perspective. For this question, evaluate: adverse effects and tolerability, impact on quality of life, treatment burden and adherence challenges, patient-reported outcomes, accessibility and cost considerations, and patient preference data.`,
        };

        return {
          name: agent.name,
          prompt: `${perspectiveMap[agent.name] || ''}

Clinical Question: "${question}"${clarifyContext}${litContext}

${citationGuard}

Provide a thorough analysis from your perspective. Use markdown formatting with headers, bullet points, and bold for key findings. Include specific data points (percentages, confidence intervals, p-values) where relevant.`,
        };
      });

      // Run agents in parallel
      const updatedAgents = [...agents];
      const promises = agentPrompts.map(async (ap, idx) => {
        updatedAgents[idx] = { ...updatedAgents[idx], status: 'running' };
        setAgents([...updatedAgents]);
        setProgressLines((prev) => [
          ...prev,
          `🔄 ${AGENTS[idx].emoji} ${ap.name} đang nghiên cứu...`,
        ]);

        try {
          const result = await callAI(model, ap.prompt, ap.name);
          if (abortRef.current) return;
          updatedAgents[idx] = { content: result, name: ap.name, status: 'done' };
          setAgents([...updatedAgents]);
          setProgressLines((prev) => [...prev, `✅ ${AGENTS[idx].emoji} ${ap.name} hoàn thành`]);
        } catch (e: any) {
          updatedAgents[idx] = { content: e.message, name: ap.name, status: 'error' };
          setAgents([...updatedAgents]);
          setProgressLines((prev) => [
            ...prev,
            `❌ ${AGENTS[idx].emoji} ${ap.name} lỗi: ${e.message}`,
          ]);
        }
      });

      await Promise.all(promises);
      if (!abortRef.current) {
        setProgressLines((prev) => [...prev, '📋 Đang tạo dàn bài...']);
        const findings = updatedAgents
          .filter((a) => a.status === 'done')
          .map((a) => `## ${a.name}\n${a.content}`)
          .join('\n\n---\n\n');
        startOutline(findings);
      }
    },
    [question, model, clarifyQs, clarifyAnswers, agents, startOutline],
  );

  /* ── Phase 2 → Research ── */
  const startResearch = useCallback(
    async (options?: { forceContinueWithoutLiterature?: boolean }) => {
      const force = options?.forceContinueWithoutLiterature ?? false;
      setPhase('research');
      abortRef.current = false;
      setNoPapersFound(false);
      setStartTime(Date.now());

      if (force) {
        // User chose to proceed despite zero papers — agents run with hardened prompt.
        setProgressLines((prev) => [
          ...prev,
          '⚠️ Tiếp tục không có y văn — agents sẽ trả lời từ kiến thức chung, không có trích dẫn.',
        ]);
        (window as any).posthog?.capture('research_no_papers_continued', {
          question: question.slice(0, 200),
          surface: 'deep_research',
        });
        await runAgentsAndOutline([], false);
        return;
      }

      setPubmedPapers([]);
      setCitationResults([]);

      // ── 1. Build search query (translate VI → EN if needed) ──
      setProgressLines((prev) => [...prev, '🌐 Đang chuẩn bị truy vấn tìm kiếm...']);
      const queryInfo = await buildSearchQuery(question, callAI, model);
      if (queryInfo.translated) {
        setProgressLines((prev) => [...prev, `🌐 Dịch sang tiếng Anh: "${queryInfo.searchQuery}"`]);
      } else if (queryInfo.fellBackToOriginal) {
        setProgressLines((prev) => [...prev, '⚠️ Dịch truy vấn thất bại, dùng câu hỏi gốc.']);
      }
      (window as any).posthog?.capture('research_query_translated', {
        detected_language: queryInfo.detectedLanguage,
        duration_ms: queryInfo.durationMs,
        fell_back_to_original: queryInfo.fellBackToOriginal,
        original_query: queryInfo.originalQuery.slice(0, 200),
        surface: 'deep_research',
        translated: queryInfo.translated,
        translated_query: queryInfo.searchQuery.slice(0, 200),
      });

      // ── 2. Literature search (multi-source) ──
      let pubmedCount = 0;
      let s2Count = 0;
      let allPapers: PubMedPaper[] = [];
      if (searchSources.has('pubmed')) {
        setProgressLines((prev) => [...prev, '🔍 Đang tìm y văn trên PubMed...']);
        const pubmedPapers = await searchPubMed(queryInfo.searchQuery, 10);
        pubmedCount = pubmedPapers.length;
        allPapers = [
          ...allPapers,
          ...pubmedPapers.map((p) => ({ ...p, source: 'pubmed' as const })),
        ];
      }
      if (searchSources.has('semantic_scholar')) {
        setProgressLines((prev) => [...prev, '🔍 Đang tìm y văn trên Semantic Scholar...']);
        const s2Papers = await searchSemanticScholar(queryInfo.searchQuery, 10);
        s2Count = s2Papers.length;
        allPapers = [...allPapers, ...s2Papers];
      }
      const papers = deduplicatePapers(allPapers);
      setPubmedPapers(papers);

      (window as any).posthog?.capture('research_papers_found', {
        detected_language: queryInfo.detectedLanguage,
        original_question: queryInfo.originalQuery.slice(0, 200),
        paper_count: papers.length,
        papers_per_source: { pubmed: pubmedCount, semantic_scholar: s2Count },
        question: question.slice(0, 200),
        sources: Array.from(searchSources),
        surface: 'deep_research',
        translated_query: queryInfo.searchQuery.slice(0, 200),
      });

      if (papers.length === 0) {
        // Gate: stop and ask the user before generating a citation-less article.
        setNoPapersFound(true);
        setProgressLines((prev) => [
          ...prev,
          '⚠️ Không tìm thấy bài báo phù hợp. Vui lòng tinh chỉnh câu hỏi hoặc tiếp tục không có y văn.',
        ]);
        (window as any).posthog?.capture('research_no_papers', {
          original_question: queryInfo.originalQuery.slice(0, 200),
          sources: Array.from(searchSources),
          surface: 'deep_research',
          translated_query: queryInfo.searchQuery.slice(0, 200),
        });
        setStartTime(null);
        return;
      }

      // Defensive: clear gate flag in case a prior racing instance left it set.
      // The useEffect that auto-triggers startResearch can fire twice across
      // re-renders; an older raw-VN search may have set noPapersFound=true
      // before the translated re-run finished and produced papers.
      setNoPapersFound(false);

      const sourceSummary = [
        pubmedCount > 0 ? `PubMed: ${pubmedCount}` : '',
        s2Count > 0 ? `S2: ${s2Count}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      setProgressLines((prev) => [
        ...prev,
        `📚 Tìm thấy ${papers.length} bài báo (${sourceSummary})`,
      ]);

      if (abortRef.current) return;
      await runAgentsAndOutline(papers, true);
    },
    [question, model, searchSources, runAgentsAndOutline],
  );

  // Keep ref in sync so handleStart can trigger it without forward reference
  startResearchRef.current = startResearch;

  // Auto-trigger research when phase transitions to 'research' but agents haven't started
  useEffect(() => {
    if (
      phase === 'research' &&
      agents.every((a) => a.status === 'idle') &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      startResearch();
    }
    // Reset flag when leaving research phase so re-entry works
    if (phase !== 'research') {
      hasAutoStartedRef.current = false;
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show "you can close" hint after 15s of waiting in article phase
  useEffect(() => {
    if (phase === 'article') {
      setArticleWaitLong(false);
      const timer = setTimeout(() => setArticleWaitLong(true), 15_000);
      return () => clearTimeout(timer);
    }
    setArticleWaitLong(false);
  }, [phase]);

  /* ── Phase 4 → Article (streaming) ── */
  const handleGenerateArticle = useCallback(async () => {
    setPhase('article');
    setArticle('');
    setProgressLines((prev) => [...prev, '✍️ Đang viết bài tổng quan...']);

    // Cool-down delay to avoid 429 after agent calls
    await new Promise<void>((r) => {
      setTimeout(r, 2000);
    });

    const articleStartTime = Date.now();
    (window as any).posthog?.capture('article_generation_started', {
      agent_count: agents.filter((a) => a.status === 'done').length,
      model,
      outline_sections: outline.length,
      surface: 'deep_research',
    });

    const agentFindings = agents
      .filter((a) => a.status === 'done')
      .map((a) => `## ${a.name}\n${a.content}`)
      .join('\n\n---\n\n');

    const outlineStr = outline
      .map((o) => {
        let s = `- ${o.title}`;
        if (o.children) {
          s += '\n' + o.children.map((c) => `  - ${c.title}`).join('\n');
        }
        return s;
      })
      .join('\n');

    // Bug C fix — inject the actual retrieved papers into the prompt so the
    // model has a concrete source-of-truth for [Author, Year] citations.
    // Without this block the model invents citations to satisfy the
    // "include inline citations" instruction.
    const papersContext = pubmedPapers
      .slice(0, 6)
      .map((p, i) => {
        const abstract = (p.abstract || '').slice(0, 300);
        const pmid = p.pmid ? ` PMID:${p.pmid}` : '';
        return `[${i + 1}] ${p.authors} (${p.year}). ${p.title}.${pmid}${abstract ? `\n     Abstract: ${abstract}${p.abstract && p.abstract.length > 300 ? '...' : ''}` : ''}`;
      })
      .join('\n\n');

    const hasLiterature = pubmedPapers.length > 0;
    const limitedLitWarning =
      pubmedPapers.length > 0 && pubmedPapers.length < 3
        ? `\n\nIMPORTANT: Only ${pubmedPapers.length} paper(s) were retrieved. The literature base is very limited. Acknowledge this in the Discussion section as a limitation. Do NOT extrapolate beyond what these papers support. Do NOT fabricate additional citations to fill gaps.`
        : '';

    // Phase 1.5.2/1.5.3 — Gemini Flash safety filter aggressively refuses
    // medical content (mental health, suicidality, mortality), emitting a
    // single "stop" token (~4 chars) instead of a refusal message. Prepend
    // shared MEDICAL_SAFETY_PREFIX (clinical-context framing) so the model
    // recognises this as a legitimate professional medical task rather
    // than patient advice. See src/utils/research/safetyPrompt.ts.
    const prompt = `You are an expert medical academic writer. Write a comprehensive literature review article based on the following outline and research findings.

Clinical Question: "${question}"

Outline:
${outlineStr}

${
  hasLiterature
    ? `=== RETRIEVED LITERATURE (cite ONLY these papers — use [Author, Year] inline format) ===
${papersContext}
=== END LITERATURE ===
`
    : `=== NO LITERATURE RETRIEVED ===
No papers were found for this question. You MUST NOT cite any specific studies, authors, journals, PMIDs, or DOIs. Use only general clinical knowledge and label it as such ("general clinical practice suggests", "standard textbook teaching"). Inventing citations is strictly prohibited.
`
}
Research Findings from Multiple Perspectives:
${agentFindings.slice(0, 15_000)}

Instructions:
1. Follow the outline structure exactly, using markdown headers (##, ###)
2. Synthesize findings from all perspectives, don't just copy them
3. ${
      hasLiterature
        ? 'Include inline citations in [Author, Year] format using ONLY the papers listed in RETRIEVED LITERATURE above. Each citation must match a real paper — do NOT invent author names or years. Include PMID when available.'
        : 'Do NOT include any author/year/PMID/DOI citations. Use generic phrasing ("evidence suggests", "clinical guidelines indicate").'
    }
4. Add a "Summary of Findings" table at the end
5. Include GRADE quality assessment for major outcomes
6. Use professional academic medical writing style
7. Total length: 2000-4000 words
8. End with "Key Takeaways" bullet points
9. Write the entire article in ${outputLang === 'vi' ? 'Vietnamese (Tiếng Việt)' : 'English'}
${limitedLitWarning}

Write the full article now in markdown format.`;

    const fullPrompt = MEDICAL_SAFETY_PREFIX + prompt;

    // Bug G fix — multi-model fallback. If the primary model returns a
    // suspiciously short payload (e.g. Gemini Flash safety-filter "stop"
    // token = 4 chars), retry with safety-tolerant alternatives. GPT-4o
    // is more permissive on documented medical adverse events.
    const ARTICLE_MODELS_FALLBACK = [
      model, // primary: user-selected model
      'gpt-4o', // fallback: better safety tolerance for medical content
      'gpt-4o-mini', // last resort: cheaper but still works
    ];
    // If output < 50 chars, treat as model refusal / safety filter trigger.
    const SUSPICIOUS_OUTPUT_THRESHOLD = 50;

    const maxRetries = ARTICLE_MODELS_FALLBACK.length;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const tryModel = ARTICLE_MODELS_FALLBACK[attempt];
      try {
        if (attempt > 0) {
          setProgressLines((prev) => [
            ...prev,
            `🔄 Thử lại với model ${tryModel} (model trước có thể bị safety filter)...`,
          ]);
        }

        // Stream article — use tryModel + fullPrompt (with safety prefix)
        const result = await callAIStream(tryModel, fullPrompt, (streamedText) => {
          setArticle(streamedText);
        });

        // Detect safety-filter refusal pattern (very short output, e.g. "stop")
        const trimmed = result.trim();
        if (trimmed.length < SUSPICIOUS_OUTPUT_THRESHOLD) {
          (window as any).posthog?.capture('article_safety_filter_suspected', {
            attempt: attempt + 1,
            model: tryModel,
            output_length: trimmed.length,
            output_preview: trimmed.slice(0, 100),
            surface: 'deep_research',
          });
          throw new Error(
            `Model ${tryModel} trả về quá ngắn (${trimmed.length} ký tự, có thể bị safety filter). Đang thử model khác...`,
          );
        }

        // Validate output — article must have meaningful content
        const wordCount = trimmed.split(/\s+/).length;
        const MIN_ARTICLE_WORDS = 200;
        if (wordCount < MIN_ARTICLE_WORDS) {
          throw new Error(
            `Bài viết chỉ có ${wordCount} từ (tối thiểu ${MIN_ARTICLE_WORDS}). ` +
              `Model có thể bị timeout hoặc context quá dài. Vui lòng thử lại hoặc chọn model khác.`,
          );
        }

        const footer = `\n\n---\n\n*📚 Generated by Phở Chat Deep Research Mode*\n*${new Date().toLocaleDateString('vi-VN')}*`;
        const finalArticle = result + footer;
        setArticle(finalArticle);
        setPhase('done'); // Only switch to done AFTER successful generation
        setProgressLines((prev) => [...prev, `✅ Bài tổng quan hoàn thành! (${wordCount} từ)`]);

        // Bug C — sanity-check citations against the actual retrieved papers.
        // Cheap heuristic: compare first-name/lastname tokens. False positives
        // are fine; we only escalate when most citations look fabricated.
        if (hasLiterature) {
          const citationRegex = /\[([^\]]+),\s*(\d{4})]/g;
          const matches = [...result.matchAll(citationRegex)];
          const validAuthors = new Set(
            pubmedPapers
              .flatMap((p) =>
                p.authors.split(/[,;]/).map((a) => a.trim().toLowerCase().split(/\s+/)[0]),
              )
              .filter(Boolean),
          );

          let invalidCount = 0;
          for (const m of matches) {
            const citedAuthor = m[1]
              .trim()
              .toLowerCase()
              .split(/[\s,]+/)[0];
            if (citedAuthor && !validAuthors.has(citedAuthor)) {
              invalidCount++;
            }
          }

          (window as any).posthog?.capture('article_citation_validation', {
            invalid_count: invalidCount,
            paper_count: pubmedPapers.length,
            surface: 'deep_research',
            total_citations: matches.length,
            validation_passed: invalidCount === 0,
          });

          if (matches.length > 0 && invalidCount / matches.length > 0.5) {
            setProgressLines((prev) => [
              ...prev,
              `⚠️ Phát hiện ${invalidCount}/${matches.length} citation có thể không khớp papers — vui lòng kiểm tra lại.`,
            ]);
          }
        }

        (window as any).posthog?.capture('article_generation_complete', {
          generation_time_seconds: Math.round((Date.now() - articleStartTime) / 1000),
          model,
          surface: 'deep_research',
          word_count: wordCount,
        });
        setStartTime(null);

        // Notify user even if panel is closed
        notification.success({
          description: 'Bấm vào đây để xem bài viết.',
          duration: 10,
          message: `✅ Bài tổng quan hoàn thành! (${finalArticle.split(/\s+/).length} từ)`,
          onClick: () => {
            useChatStore.getState().openDeepResearch();
            notification.destroy();
          },
          placement: 'topRight',
          style: { cursor: 'pointer' },
        });

        // Save to history
        const historyItem: HistoryItem = {
          article: finalArticle,
          date: new Date().toISOString(),
          id: `dr-${Date.now()}`,
          lang: outputLang,
          model,
          question,
        };
        setHistory((prev) => {
          const updated = [historyItem, ...prev].slice(0, 20);
          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
          } catch {
            /* ignore */
          }
          return updated;
        });

        // Auto-verify citations against PubMed
        setIsVerifying(true);
        setProgressLines((prev) => [...prev, '🔍 Đang xác minh citations trên PubMed...']);
        try {
          const verifyResults = await verifyCitationsAgainstPubMed(finalArticle);
          setCitationResults(verifyResults);
          const verified = verifyResults.filter((r) => r.status === 'verified').length;
          setProgressLines((prev) => [
            ...prev,
            `✅ Xác minh xong: ${verified}/${verifyResults.length} citations tìm thấy trên PubMed`,
          ]);
        } catch {
          setProgressLines((prev) => [...prev, '⚠️ Không thể xác minh citations']);
        }
        setIsVerifying(false);

        // Auto-generate GRADE evidence table
        setIsGeneratingGrade(true);
        setProgressLines((prev) => [...prev, '📊 Đang đánh giá chất lượng bằng chứng (GRADE)...']);
        try {
          const agentFindings = agents
            .filter((a) => a.content)
            .map((a) => `[${a.name}]: ${a.content.slice(0, 800)}`)
            .join('\n');
          const gradePrompt = `You are an expert in evidence-based medicine and the GRADE (Grading of Recommendations, Assessment, Development and Evaluation) methodology.

Based on the following systematic review article and research agent findings, generate a GRADE evidence quality assessment table.

Research Question: ${question}

Agent Findings:
${agentFindings}

Article excerpt:
${finalArticle.slice(0, 3000)}

For each key clinical outcome discussed, assess:
1. Study Design (e.g., RCT, Observational, Case series)
2. Risk of Bias (Serious/Not serious) 
3. Inconsistency (Serious/Not serious)
4. Indirectness (Serious/Not serious)
5. Imprecision (Serious/Not serious)
6. Overall Quality (High/Moderate/Low/Very Low)

Respond with ONLY a valid JSON array, no markdown:
[{"outcome":"...","studyDesign":"...","riskOfBias":"...","inconsistency":"...","indirectness":"...","imprecision":"...","overallQuality":"High|Moderate|Low|Very Low"}]

Generate 3-6 rows for the most important outcomes.`;

          const gradeResult = await callAI(model, gradePrompt);
          const jsonMatch = gradeResult.match(/\[\s*{[\S\s]*?}\s*]/)?.[0];
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch) as GradeRow[];
            setGradeData(parsed);
            setProgressLines((prev) => [
              ...prev,
              `✅ GRADE: ${parsed.length} outcomes đã đánh giá`,
            ]);
          }
        } catch (gradeErr) {
          console.warn('[DeepResearch] GRADE generation failed:', gradeErr);
          setProgressLines((prev) => [...prev, '⚠️ Không thể tạo GRADE table']);
        }
        setIsGeneratingGrade(false);
        return; // Success — exit retry loop
      } catch (e: any) {
        lastError = e;
        console.error(
          `[DeepResearch] Article attempt ${attempt + 1} (model=${tryModel}) failed:`,
          e.message,
        );
      }
    }

    // All retries failed
    (window as any).posthog?.capture('article_generation_failed', {
      error: lastError?.message || 'Unknown error',
      generation_time_seconds: Math.round((Date.now() - articleStartTime) / 1000),
      models_tried: ARTICLE_MODELS_FALLBACK,
      primary_model: model,
      surface: 'deep_research',
    });

    setProgressLines((prev) => [
      ...prev,
      `❌ Lỗi viết bài: ${lastError?.message || 'Unknown error'}. Vui lòng thử lại.`,
    ]);
    message.error(
      `Lỗi viết bài: ${lastError?.message || 'Server timeout'}. Bấm "Viết bài" để thử lại.`,
    );
    setPhase('outline'); // Go back to outline so user can retry
  }, [question, model, outline, agents, outputLang]);

  /* ── Fetch References for Citation Network ── */
  const fetchReferences = useCallback(
    async (paperId: string) => {
      if (networkData[paperId]) {
        setExpandedNetworkNode(expandedNetworkNode === paperId ? null : paperId);
        return;
      }
      setLoadingNetwork(paperId);
      setExpandedNetworkNode(paperId);
      try {
        const res = await fetch(
          `/api/research/semantic-scholar/references?paperId=${encodeURIComponent(paperId)}&limit=8`,
          {
            credentials: 'include',
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (res.ok) {
          const data = await res.json();
          setNetworkData((prev) => ({ ...prev, [paperId]: data.references || [] }));
        }
      } catch {
        console.warn('[DeepResearch] Failed to fetch references for', paperId);
      }
      setLoadingNetwork(null);
    },
    [networkData, expandedNetworkNode],
  );

  /* \u2500\u2500 Reset \u2500\u2500 */
  const handleReset = () => {
    abortRef.current = true;
    abortControllerRef.current?.abort();
    setPhase('input');
    setQuestion('');
    setClarifyQs([]);
    setClarifyAnswers({});
    setAgents(AGENTS.map((a) => ({ content: '', name: a.name, status: 'idle' })));
    setProgressLines([]);
    setOutline([]);
    setArticle('');
    setExpandedAgent(null);
    setStartTime(null);
    setPubmedPapers([]);
    setCitationResults([]);
    setIsVerifying(false);
    setGradeData([]);
    setShowGrade(false);
    setIsGeneratingGrade(false);
    setShowNetwork(false);
    setNetworkData({});
    setExpandedNetworkNode(null);
    setEvaluatorMode('hidden');
    setEvaluatorStep(0);
    setEvaluatorInput('');
    setEvaluatorAnswers([]);
    setEvaluatorResult('');
    setIsEvaluating(false);
  };

  /* ────── Evaluator constants & handlers ────── */
  const EVALUATOR_SYSTEM_PROMPT = `You are a research strategy advisor using the Fischbach & Walsh framework (Cell 2024). Evaluate research ideas on two axes: Feasibility (X) × Impact (Y).

Key rules:
- No risk = incremental work (bad). Multiple miracles needed = avoid/refine.
- Fix ONE meaningful constraint, keep rest flexible.
- Output format: Restatement → Feasibility: [H/M/L] → Impact: [H/M/L] → Risks (1-3 bullets) → Recommendation: ✅ Go / 🔄 Refine / 🔀 Pivot → Specific suggestions.
- Respond in the same language as the user's input.`;

  const PITCH_QUESTIONS = [
    'Bạn muốn làm gì? (Mô tả ý tưởng nghiên cứu)',
    'Plan thực hiện như thế nào?',
    'Nếu thành công, tại sao đây là đột phá?',
    'Risk chính là gì?',
  ];

  const handleEvaluatorSubmitPitch = useCallback(async () => {
    if (evaluatorStep < PITCH_QUESTIONS.length - 1) {
      setEvaluatorAnswers((prev) => [...prev, evaluatorInput]);
      setEvaluatorInput('');
      setEvaluatorStep((s) => s + 1);
      return;
    }
    const allAnswers = [...evaluatorAnswers, evaluatorInput];
    setIsEvaluating(true);
    try {
      const prompt = `${EVALUATOR_SYSTEM_PROMPT}

The researcher pitched an idea:
Idea: "${allAnswers[0]}"
Plan: "${allAnswers[1]}"
Why breakthrough: "${allAnswers[2]}"
Main risk: "${allAnswers[3]}"

Evaluate this research idea. Provide your assessment with Feasibility × Impact ratings and a clear recommendation.`;
      const result = await callAI(model, prompt);
      setEvaluatorResult(result);
      if (result.includes('\u2705') || result.toLowerCase().includes('go')) {
        setQuestion(allAnswers[0]);
      }
    } catch (e: any) {
      message.error(`Lỗi đánh giá: ${e.message}`);
    } finally {
      setIsEvaluating(false);
    }
  }, [evaluatorStep, evaluatorInput, evaluatorAnswers, model]);

  const handleEvaluatorSubmitTroubleshoot = useCallback(async () => {
    setIsEvaluating(true);
    try {
      const prompt = `${EVALUATOR_SYSTEM_PROMPT}

The researcher is troubleshooting a problem:
"${evaluatorInput}"

First, classify this problem as: Conceptual / Technical / Strategic.
Then guide them step-by-step through a decision tree to resolve it. Be specific and actionable.`;
      const result = await callAI(model, prompt);
      setEvaluatorResult(result);
    } catch (e: any) {
      message.error(`Lỗi: ${e.message}`);
    } finally {
      setIsEvaluating(false);
    }
  }, [evaluatorInput, model]);

  const handleEvaluatorSubmitStrategic = useCallback(async () => {
    setIsEvaluating(true);
    try {
      const prompt = `${EVALUATOR_SYSTEM_PROMPT}

The researcher asks a strategic question:
"${evaluatorInput}"

Use the "altitude dance" framework: zoom out to see the big picture (field trends, unmet needs, paradigm shifts), then zoom in to specific actionable advice. Balance ambition with pragmatism.`;
      const result = await callAI(model, prompt);
      setEvaluatorResult(result);
    } catch (e: any) {
      message.error(`Lỗi: ${e.message}`);
    } finally {
      setIsEvaluating(false);
    }
  }, [evaluatorInput, model]);

  const handleEvaluatorReset = () => {
    setEvaluatorMode('hidden');
    setEvaluatorStep(0);
    setEvaluatorInput('');
    setEvaluatorAnswers([]);
    setEvaluatorResult('');
    setIsEvaluating(false);
  };

  /* \u2500\u2500 Stop \u2500\u2500 */
  const handleStop = () => {
    abortRef.current = true;
    abortControllerRef.current?.abort();
    setStartTime(null);
    setProgressLines((prev) => [...prev, '⛔ Người dùng đã dừng nghiên cứu']);
    message.info('Đã dừng nghiên cứu');
  };

  /* \u2500\u2500 History \u2500\u2500 */
  const handleLoadHistory = (item: HistoryItem) => {
    setQuestion(item.question);
    setModel(item.model);
    setOutputLang(item.lang);
    setArticle(item.article);
    setPhase('done');
    setShowHistory(false);
    setProgressLines(['\uD83D\uDCE5 T\u1EA3i t\u1EEB l\u1ECBch s\u1EED nghi\u00EAn c\u1EE9u']);
  };

  const handleDeleteHistory = (id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((h) => h.id !== id);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      } catch {
        /* ignore */
      }
      return updated;
    });
  };

  /* ── Outline editing ── */
  const handleAddOutlineItem = () => {
    setOutline((prev) => [...prev, { title: `${prev.length + 1}. New Section` }]);
  };

  const handleDeleteOutlineItem = (idx: number) => {
    setOutline((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleMoveOutlineItem = (idx: number, direction: 'up' | 'down') => {
    setOutline((prev) => {
      const next = [...prev];
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= next.length) return prev;
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next;
    });
  };

  const handleSaveOutlineEdit = (idx: number) => {
    setOutline((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, title: editingText } : item)),
    );
    setEditingOutlineIdx(null);
    setEditingText('');
  };

  /* ── Follow-up refinement ── */
  const handleRefine = useCallback(async () => {
    if (!refinePrompt.trim() || isRefining) return;
    setIsRefining(true);
    setProgressLines((prev) => [...prev, `🔄 Đang tinh chỉnh: "${refinePrompt.slice(0, 50)}..."`]);

    try {
      const prompt = `You are an expert medical academic writer. Below is an existing literature review article. The user wants you to refine/modify it based on their instruction.

Current Article:
${article.slice(0, 20_000)}

User Instruction: "${refinePrompt}"

Instructions:
1. Apply the user's requested change to the article
2. Keep the overall structure and formatting intact
3. Only modify the relevant sections
4. Maintain academic medical writing style
5. Write in ${outputLang === 'vi' ? 'Vietnamese (Tiếng Việt)' : 'English'}

Return the full updated article in markdown format.`;

      const result = await callAI(model, prompt);
      const footer = `\n\n---\n\n*📚 Generated by Phở Chat Deep Research Mode*\n*${new Date().toLocaleDateString('vi-VN')} — Refined*`;
      setArticle(result + footer);
      setRefinePrompt('');
      setProgressLines((prev) => [...prev, '✅ Đã tinh chỉnh bài viết']);
      message.success('Đã tinh chỉnh bài viết thành công');
    } catch (e: any) {
      message.error(`Lỗi tinh chỉnh: ${e.message}`);
    } finally {
      setIsRefining(false);
    }
  }, [refinePrompt, isRefining, article, model, outputLang]);

  /* ── Export ── */
  const handleDownloadMd = () => {
    downloadFile(article, `deep-research-${Date.now()}.md`, 'text/markdown');
  };

  const handleDownloadHtml = () => {
    const renderedBody = marked.parse(article) as string;
    const htmlContent = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Deep Research - ${question.slice(0, 60)}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #1a1a1a; }
  h1 { color: #1a365d; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
  h2 { color: #2d3748; margin-top: 2em; }
  h3 { color: #4a5568; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
  th { background: #f7fafc; font-weight: 600; }
  blockquote { border-left: 4px solid #667eea; margin: 1em 0; padding: 0.5em 1em; background: #f7fafc; }
  code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  pre { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }
  .footer { margin-top: 3em; padding-top: 1em; border-top: 1px solid #e2e8f0; color: #718096; font-size: 0.85em; }
</style>
</head>
<body>
${renderedBody}
<div class="footer">
  <p>\uD83D\uDCDA Generated by Ph\u1EDF Chat Deep Research Mode \u2014 Inspired by Stanford STORM</p>
  <p>${new Date().toLocaleDateString('vi-VN')}</p>
</div>
</body>
</html>`;
    downloadFile(htmlContent, `deep-research-${Date.now()}.html`, 'text/html');
  };

  const handlePrintPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      message.error('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
      return;
    }
    const renderedBody = marked.parse(article) as string;
    printWindow.document.write(`<!DOCTYPE html>
<html><head><title>Deep Research</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; max-width: 800px; margin: 20px auto; line-height: 1.7; color: #1a1a1a; font-size: 11pt; }
  h1 { font-size: 18pt; color: #1a365d; }
  h2 { font-size: 14pt; color: #2d3748; margin-top: 1.5em; }
  h3 { font-size: 12pt; color: #4a5568; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 10pt; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; }
  th { background: #f0f0f0; }
  @media print { body { margin: 0; } }
</style></head><body>
${renderedBody}
</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(article);
    message.success('Đã sao chép vào clipboard');
  };

  /* ── BibTeX Export ── */
  const handleExportBibtex = () => {
    // Use pubmedPapers if available, otherwise generate from citationResults
    let papers = pubmedPapers;
    if (papers.length === 0 && citationResults.length > 0) {
      papers = citationResults
        .filter((r) => r.status === 'verified' && r.pmid)
        .map((r) => ({
          abstract: '',
          authors: r.citation,
          journal: '',
          pmid: r.pmid || '',
          title: r.title || r.citation,
          year: r.citation.match(/(\d{4})/)?.[1] || '',
        }));
    }
    if (papers.length === 0) {
      message.warning('Chưa có references để export');
      return;
    }
    const entries = papers.map((p, i) => {
      const key = `${(p.authors || 'Unknown').split(' ')[0]}${p.year}_${i + 1}`;
      return `@article{${key},
  author = {${p.authors}},
  title = {${p.title}},
  journal = {${p.journal}},
  year = {${p.year}},
  pmid = {${p.pmid}},
  url = {https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/}
}`;
    });
    downloadFile(
      entries.join('\n\n'),
      `deep-research-refs-${Date.now()}.bib`,
      'application/x-bibtex',
    );
    message.success(`Đã export ${entries.length} references (BibTeX)`);
  };

  const handleExportRis = () => {
    // Use pubmedPapers if available, otherwise generate from citationResults
    let papers = pubmedPapers;
    if (papers.length === 0 && citationResults.length > 0) {
      papers = citationResults
        .filter((r) => r.status === 'verified' && r.pmid)
        .map((r) => ({
          abstract: '',
          authors: r.citation,
          journal: '',
          pmid: r.pmid || '',
          title: r.title || r.citation,
          year: r.citation.match(/(\d{4})/)?.[1] || '',
        }));
    }
    if (papers.length === 0) {
      message.warning('Chưa có references để export');
      return;
    }
    const entries = papers.map((p) => {
      return `TY  - JOUR
AU  - ${p.authors}
TI  - ${p.title}
JO  - ${p.journal}
PY  - ${p.year}
AN  - ${p.pmid}
UR  - https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/
ER  - `;
    });
    downloadFile(
      entries.join('\n\n'),
      `deep-research-refs-${Date.now()}.ris`,
      'application/x-research-info-systems',
    );
    message.success(`Đã export ${entries.length} references (RIS)`);
  };

  /* ── PRISMA Flowchart ── */
  const generatePrismaData = useCallback(() => {
    const totalIdentified = pubmedPapers.length;
    const agentsDone = agents.filter((a) => a.status === 'done').length;
    const outlineSections = outline.length;

    let verifiedCount = citationResults.filter((r) => r.status === 'verified').length;
    let unverifiedCount = citationResults.filter((r) => r.status === 'unverified').length;
    let totalCitations = citationResults.length;

    // Fallback: extract citations from article text if citationResults is empty
    if (totalCitations === 0 && article.length > 0) {
      const citationMatches = article.match(/\[[\s\w,.]+(?:et al\.?)?,?\s*\d{4}]/g);
      const uniqueCitations = new Set(citationMatches || []);
      totalCitations = uniqueCitations.size;
      // When verification hasn't run yet, show all as "pending"
      verifiedCount = isVerifying ? 0 : totalCitations;
      unverifiedCount = 0;
    }

    return {
      agentsDone,
      isVerifying,
      outlineSections,
      totalCitations,
      totalIdentified,
      unverifiedCount,
      verifiedCount,
    };
  }, [pubmedPapers, citationResults, agents, outline, article, isVerifying]);

  /* ── Render ── */
  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Title */}
      <Flexbox align={'center'} gap={8} horizontal>
        <BookOpen size={22} />
        <span className={styles.header}>Deep Research</span>
      </Flexbox>
      <span className={styles.subtitle}>Tạo bài tổng quan y văn tự động với citations</span>

      {/* Phase Bar */}
      <div className={styles.phaseBar}>
        {PHASES_LIST.map((p, i) => (
          <span
            className={cx(
              i < phaseIndex
                ? styles.phaseDone
                : i === phaseIndex
                  ? styles.phaseActive
                  : styles.phaseItem,
            )}
            key={p.key}
          >
            {p.label}
          </span>
        ))}
      </div>

      {/* ────── PHASE: INPUT ────── */}
      {phase === 'input' && (
        <Flexbox gap={12}>
          {/* ── Research Idea Evaluator ── */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(102,126,234,0.08), rgba(118,75,162,0.08))',
              border: '1px solid rgba(102,126,234,0.2)',
              borderRadius: 12,
              padding: 12,
            }}
          >
            <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {'\uD83D\uDCA1'} Đánh giá ý tưởng nghiên cứu
              </span>
              {evaluatorMode !== 'hidden' && (
                <Button onClick={handleEvaluatorReset} size="small" type="text">
                  <X size={12} /> Bỏ qua
                </Button>
              )}
            </Flexbox>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 }}>
              Fischbach & Walsh (Cell 2024) — Problem Choice {'>'} Execution Quality
            </div>

            {evaluatorMode === 'hidden' && (
              <Flexbox gap={6} horizontal style={{ marginTop: 8 }}>
                <Button
                  icon={<Sparkles size={12} />}
                  onClick={() => {
                    setEvaluatorMode('pitch');
                    setEvaluatorStep(0);
                    setEvaluatorAnswers([]);
                    setEvaluatorInput('');
                    setEvaluatorResult('');
                  }}
                  size="small"
                >
                  Pitch an Idea
                </Button>
                <Button
                  icon={<RefreshCw size={12} />}
                  onClick={() => {
                    setEvaluatorMode('troubleshoot');
                    setEvaluatorInput('');
                    setEvaluatorResult('');
                  }}
                  size="small"
                >
                  Troubleshoot
                </Button>
                <Button
                  icon={<MessageSquare size={12} />}
                  onClick={() => {
                    setEvaluatorMode('strategic');
                    setEvaluatorInput('');
                    setEvaluatorResult('');
                  }}
                  size="small"
                >
                  Strategic Q
                </Button>
              </Flexbox>
            )}

            {/* Pitch mode */}
            {evaluatorMode === 'pitch' && !evaluatorResult && (
              <Flexbox gap={8} style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>
                  {evaluatorStep + 1}/{PITCH_QUESTIONS.length}: {PITCH_QUESTIONS[evaluatorStep]}
                </span>
                <TextArea
                  autoSize={{ maxRows: 4, minRows: 2 }}
                  disabled={isEvaluating}
                  onChange={(e) => setEvaluatorInput(e.target.value)}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleEvaluatorSubmitPitch();
                    }
                  }}
                  placeholder="Nhập câu trả lời..."
                  style={{ fontSize: 13 }}
                  value={evaluatorInput}
                />
                <Button
                  disabled={!evaluatorInput.trim()}
                  loading={isEvaluating}
                  onClick={handleEvaluatorSubmitPitch}
                  size="small"
                  type="primary"
                >
                  {evaluatorStep < PITCH_QUESTIONS.length - 1 ? 'Tiếp →' : 'Đánh giá'}
                </Button>
              </Flexbox>
            )}

            {/* Troubleshoot mode */}
            {evaluatorMode === 'troubleshoot' && !evaluatorResult && (
              <Flexbox gap={8} style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>
                  Bạn đang gặp vấn đề gì trong nghiên cứu?
                </span>
                <TextArea
                  autoSize={{ maxRows: 4, minRows: 2 }}
                  disabled={isEvaluating}
                  onChange={(e) => setEvaluatorInput(e.target.value)}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleEvaluatorSubmitTroubleshoot();
                    }
                  }}
                  placeholder="Mô tả vấn đề bạn đang gặp..."
                  style={{ fontSize: 13 }}
                  value={evaluatorInput}
                />
                <Button
                  disabled={!evaluatorInput.trim()}
                  loading={isEvaluating}
                  onClick={handleEvaluatorSubmitTroubleshoot}
                  size="small"
                  type="primary"
                >
                  Phân tích
                </Button>
              </Flexbox>
            )}

            {/* Strategic mode */}
            {evaluatorMode === 'strategic' && !evaluatorResult && (
              <Flexbox gap={8} style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>
                  Câu hỏi chiến lược nghiên cứu của bạn?
                </span>
                <TextArea
                  autoSize={{ maxRows: 4, minRows: 2 }}
                  disabled={isEvaluating}
                  onChange={(e) => setEvaluatorInput(e.target.value)}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleEvaluatorSubmitStrategic();
                    }
                  }}
                  placeholder="Hỏi về chiến lược nghiên cứu..."
                  style={{ fontSize: 13 }}
                  value={evaluatorInput}
                />
                <Button
                  disabled={!evaluatorInput.trim()}
                  loading={isEvaluating}
                  onClick={handleEvaluatorSubmitStrategic}
                  size="small"
                  type="primary"
                >
                  Tư vấn
                </Button>
              </Flexbox>
            )}

            {/* Evaluator result */}
            {evaluatorResult && (
              <Flexbox gap={8} style={{ marginTop: 8 }}>
                <div
                  style={{
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: 8,
                    maxHeight: 300,
                    overflowY: 'auto',
                    padding: 12,
                  }}
                >
                  <Markdown>{evaluatorResult}</Markdown>
                </div>
                <Flexbox gap={6} horizontal>
                  <Button onClick={handleEvaluatorReset} size="small">
                    Đánh giá lại
                  </Button>
                  <Button
                    onClick={() => {
                      if (
                        !question.trim() &&
                        evaluatorMode === 'pitch' &&
                        evaluatorAnswers.length > 0
                      ) {
                        setQuestion(evaluatorAnswers[0]);
                      }
                      handleEvaluatorReset();
                    }}
                    size="small"
                    type="primary"
                  >
                    → Tiếp tục nghiên cứu
                  </Button>
                </Flexbox>
              </Flexbox>
            )}

            {isEvaluating && (
              <Flexbox align={'center'} gap={6} horizontal style={{ marginTop: 8 }}>
                <Spin size="small" />
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                  Đang đánh giá...
                </span>
              </Flexbox>
            )}
          </div>

          <TextArea
            autoSize={{ maxRows: 6, minRows: 3 }}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Nhập câu hỏi nghiên cứu lâm sàng... Ví dụ: What is the efficacy of GLP-1 agonists vs SGLT2 inhibitors for type 2 diabetes with heart failure?"
            style={{ fontSize: 14 }}
            value={question}
          />
          <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
            <Select onChange={setModel} options={MODELS} style={{ width: 200 }} value={model} />
            <Select
              onChange={setOutputLang}
              options={LANGUAGES}
              style={{ width: 140 }}
              value={outputLang}
            />
            <Flexbox align={'center'} gap={6} horizontal style={{ fontSize: 12 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Nguồn:</span>
              <label style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', gap: 3 }}>
                <input
                  checked={searchSources.has('pubmed')}
                  onChange={(e) => {
                    const next = new Set(searchSources);
                    if (e.target.checked) next.add('pubmed');
                    else next.delete('pubmed');
                    if (next.size > 0) setSearchSources(next);
                  }}
                  type="checkbox"
                />
                🔬 PubMed
              </label>
              <label style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', gap: 3 }}>
                <input
                  checked={searchSources.has('semantic_scholar')}
                  onChange={(e) => {
                    const next = new Set(searchSources);
                    if (e.target.checked) next.add('semantic_scholar');
                    else next.delete('semantic_scholar');
                    if (next.size > 0) setSearchSources(next);
                  }}
                  type="checkbox"
                />
                📚 Semantic Scholar
              </label>
            </Flexbox>
            <Button
              disabled={!question.trim()}
              icon={<Sparkles size={14} />}
              onClick={handleStart}
              type="primary"
            >
              {'🚀 Bắt đầu nghiên cứu'}
            </Button>
            <Tooltip
              title={
                showHistory ? '\u1EA8n l\u1ECBch s\u1EED' : 'L\u1ECBch s\u1EED nghi\u00EAn c\u1EE9u'
              }
            >
              <Button
                icon={<Clock size={14} />}
                onClick={() => setShowHistory(!showHistory)}
                type={showHistory ? 'primary' : 'default'}
              />
            </Tooltip>
          </Flexbox>

          {/* History panel */}
          {showHistory && (
            <Flexbox gap={4} style={{ maxHeight: 200, overflowY: 'auto' }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {'📋 Lịch sử nghiên cứu'} ({history.length}):
              </span>
              {history.length === 0 ? (
                <span style={{ color: '#888', fontSize: 12 }}>Chưa có nghiên cứu nào</span>
              ) : (
                history.map((item) => (
                  <div className={styles.historyItem} key={item.id}>
                    <span className={styles.historyLabel} onClick={() => handleLoadHistory(item)}>
                      {item.question.slice(0, 60)}
                      {item.question.length > 60 ? '...' : ''}
                    </span>
                    <Tag style={{ fontSize: 10 }}>
                      {new Date(item.date).toLocaleDateString('vi-VN')}
                    </Tag>
                    <Tooltip title="X\u00F3a">
                      <Button
                        danger
                        icon={<Trash2 size={10} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteHistory(item.id);
                        }}
                        size="small"
                        type="text"
                      />
                    </Tooltip>
                  </div>
                ))
              )}
            </Flexbox>
          )}

          {/* Templates panel */}
          {!showHistory && (
            <Flexbox gap={4}>
              <Button
                icon={<Search size={12} />}
                onClick={() => setShowTemplates(!showTemplates)}
                size="small"
                type="link"
              >
                {showTemplates ? 'Ẩn mẫu' : '📚 Câu hỏi mẫu theo chuyên khoa'}
              </Button>
              {showTemplates && (
                <Flexbox gap={6}>
                  {TEMPLATES.map((cat) => (
                    <div key={cat.cat}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>{cat.cat}</span>
                      {cat.questions.map((q) => (
                        <div
                          key={q}
                          onClick={() => {
                            setQuestion(q);
                            setShowTemplates(false);
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')
                          }
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          style={{
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 11,
                            padding: '2px 8px',
                          }}
                        >
                          {q.slice(0, 80)}
                          {q.length > 80 ? '...' : ''}
                        </div>
                      ))}
                    </div>
                  ))}
                </Flexbox>
              )}
            </Flexbox>
          )}
        </Flexbox>
      )}

      {/* ────── PHASE: CLARIFY ────── */}
      {phase === 'clarify' && (
        <Flexbox gap={12}>
          <span style={{ fontWeight: 600 }}>❓ Câu hỏi làm rõ phạm vi nghiên cứu:</span>
          {clarifyQs.length === 0 ? (
            <Spin size="small" />
          ) : (
            <>
              {clarifyQs.map((q, i) => (
                <Flexbox gap={4} key={i}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {i + 1}. {q}
                  </span>
                  <Input
                    onChange={(e) =>
                      setClarifyAnswers((prev) => ({ ...prev, [i]: e.target.value }))
                    }
                    placeholder="Trả lời (tùy chọn — bỏ trống nếu không có yêu cầu cụ thể)"
                    size="small"
                    value={clarifyAnswers[i] || ''}
                  />
                </Flexbox>
              ))}
              <Button
                icon={<Search size={14} />}
                onClick={() => {
                  hasAutoStartedRef.current = true;
                  startResearch();
                }}
                type="primary"
              >
                Tiếp tục nghiên cứu →
              </Button>
            </>
          )}
        </Flexbox>
      )}

      {/* ────── No papers found gate ────── */}
      {phase === 'research' && noPapersFound && (
        <Flexbox
          gap={8}
          style={{
            background: 'rgba(234,179,8,0.08)',
            border: '1px solid rgba(234,179,8,0.4)',
            borderRadius: 8,
            padding: 12,
          }}
        >
          <Flexbox align={'center'} gap={8} horizontal>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Không tìm thấy bài báo phù hợp</span>
          </Flexbox>
          <span style={{ color: '#888', fontSize: 12 }}>
            Cả PubMed và Semantic Scholar đều không trả về bài báo cho truy vấn này. Việc viết bài
            tổng quan không có y văn sẽ không có trích dẫn xác thực và{' '}
            <strong>không khuyến nghị cho mục đích lâm sàng</strong>.
          </span>
          <Flexbox gap={6} horizontal style={{ flexWrap: 'wrap' }}>
            <Button
              icon={<Pencil size={12} />}
              onClick={() => {
                setPhase('input');
                setNoPapersFound(false);
                setAgents(AGENTS.map((a) => ({ content: '', name: a.name, status: 'idle' })));
                setProgressLines([]);
              }}
              size="small"
              type="primary"
            >
              Tinh chỉnh câu hỏi
            </Button>
            <Button
              icon={<RefreshCw size={12} />}
              onClick={() => {
                setNoPapersFound(false);
                setAgents(AGENTS.map((a) => ({ content: '', name: a.name, status: 'idle' })));
                hasAutoStartedRef.current = true;
                startResearch();
              }}
              size="small"
            >
              Thử lại
            </Button>
            <Button
              danger
              icon={<Play size={12} />}
              onClick={() => {
                setAgents(AGENTS.map((a) => ({ content: '', name: a.name, status: 'idle' })));
                hasAutoStartedRef.current = true;
                startResearch({ forceContinueWithoutLiterature: true });
              }}
              size="small"
            >
              Tiếp tục không có y văn
            </Button>
          </Flexbox>
        </Flexbox>
      )}

      {/* ────── PHASE: RESEARCH + AGENTS ────── */}
      {(phase === 'research' || phase === 'outline' || phase === 'article' || phase === 'done') &&
        !noPapersFound && (
          <Flexbox gap={8}>
            <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
              <Flexbox align={'center'} gap={8} horizontal>
                <span style={{ fontWeight: 600 }}>{'🤖 AI Research Agents:'}</span>
                {phase === 'research' && (
                  <Tag color="processing" style={{ fontSize: 11 }}>
                    ⏱️ {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} —{' '}
                    {agents.filter((a) => a.status === 'done').length}/{agents.length} xong
                  </Tag>
                )}
              </Flexbox>
              {phase === 'research' && (
                <Button danger icon={<StopCircle size={14} />} onClick={handleStop} size="small">
                  Dừng
                </Button>
              )}
            </Flexbox>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {agents.map((agent, idx) => (
                <div
                  className={cx(
                    styles.agentCard,
                    agent.status === 'running' && styles.agentRunning,
                    agent.status === 'done' && styles.agentDone,
                    agent.status === 'error' && styles.agentError,
                  )}
                  key={agent.name}
                  onClick={() => setExpandedAgent(expandedAgent === idx ? null : idx)}
                >
                  <Flexbox align={'center'} gap={6} horizontal>
                    <span>{AGENTS[idx].emoji}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{agent.name}</span>
                    {agent.status === 'running' && <Loader2 className="animate-spin" size={12} />}
                    {agent.status === 'done' && (
                      <Tag color="success" style={{ fontSize: 10 }}>
                        ✓
                      </Tag>
                    )}
                    {agent.status === 'error' && (
                      <Tag color="error" style={{ fontSize: 10 }}>
                        ✗
                      </Tag>
                    )}
                    {agent.status === 'done' && (
                      <Tooltip
                        title={
                          expandedAgent === idx ? '\u1EA8n chi ti\u1EBFt' : 'Xem chi ti\u1EBFt'
                        }
                      >
                        {expandedAgent === idx ? <EyeOff size={12} /> : <Eye size={12} />}
                      </Tooltip>
                    )}
                  </Flexbox>
                  <span style={{ color: '#888', fontSize: 11 }}>{AGENTS[idx].desc}</span>
                  {expandedAgent === idx && agent.content && (
                    <div className={styles.agentContent}>
                      <Markdown>{agent.content.slice(0, 3000)}</Markdown>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Flexbox>
        )}

      {/* PubMed Papers */}
      {pubmedPapers.length > 0 &&
        (phase === 'research' ||
          phase === 'outline' ||
          phase === 'article' ||
          phase === 'done') && (
          <Flexbox
            gap={6}
            style={{ background: 'rgba(0,150,255,0.05)', borderRadius: 8, padding: '8px 12px' }}
          >
            <Flexbox align={'center'} gap={6} horizontal>
              <BookOpen size={14} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Y văn ({pubmedPapers.length} bài báo)
              </span>
            </Flexbox>
            <div style={{ display: 'grid', gap: 4 }}>
              {(showAllPapers ? pubmedPapers : pubmedPapers.slice(0, 6)).map((p) => (
                <a
                  href={
                    p.source === 'semantic_scholar'
                      ? `https://www.semanticscholar.org/paper/${p.pmid}`
                      : `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`
                  }
                  key={p.pmid + p.title.slice(0, 20)}
                  rel="noreferrer"
                  style={{
                    color: '#1890ff',
                    cursor: 'pointer',
                    fontSize: 11,
                    textDecoration: 'none',
                  }}
                  target="_blank"
                >
                  <Tag
                    color={p.source === 'semantic_scholar' ? 'purple' : 'blue'}
                    style={{ fontSize: 8, marginRight: 4 }}
                  >
                    {p.source === 'semantic_scholar' ? 'S2' : 'PM'}
                  </Tag>
                  <span style={{ fontWeight: 500 }}>
                    {p.authors} ({p.year}).
                  </span>{' '}
                  {p.title.slice(0, 100)}
                  {p.title.length > 100 ? '...' : ''}
                  {p.citationCount ? (
                    <Tag style={{ fontSize: 8, marginLeft: 4 }}>📝 {p.citationCount}</Tag>
                  ) : null}
                </a>
              ))}
              {pubmedPapers.length > 6 && (
                <span
                  onClick={() => setShowAllPapers(!showAllPapers)}
                  style={{ color: '#1890ff', cursor: 'pointer', fontSize: 11, fontWeight: 500 }}
                >
                  {showAllPapers
                    ? '▲ Thu gọn'
                    : `▼ Xem thêm ${pubmedPapers.length - 6} bài báo khác`}
                </span>
              )}
            </div>
          </Flexbox>
        )}

      {/* Progress Log */}
      {progressLines.length > 0 && phase !== 'input' && (
        <Flexbox
          gap={2}
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            maxHeight: 200,
            overflowY: 'auto',
            padding: '8px 12px',
          }}
        >
          <span style={{ color: '#aaa', fontSize: 11, fontWeight: 600, marginBottom: 2 }}>
            Quá trình nghiên cứu:
          </span>
          {progressLines.map((line, i) => (
            <div className={styles.progressLine} key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>
              {line}
            </div>
          ))}
        </Flexbox>
      )}

      {/* ────── PHASE: OUTLINE ────── */}
      {(phase === 'outline' || phase === 'done') && outline.length > 0 && (
        <Flexbox gap={8}>
          <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
            <span style={{ fontWeight: 600 }}>📋 Dàn bài tổng quan:</span>
            <Flexbox gap={4} horizontal>
              {phase === 'outline' && (
                <>
                  <Tooltip title="Thêm mục">
                    <Button icon={<Plus size={12} />} onClick={handleAddOutlineItem} size="small" />
                  </Tooltip>
                  <Button
                    icon={<Play size={12} />}
                    onClick={handleGenerateArticle}
                    size="small"
                    type="primary"
                  >
                    Viết bài →
                  </Button>
                </>
              )}
            </Flexbox>
          </Flexbox>
          <div style={{ paddingLeft: 8 }}>
            {outline.map((item, idx) => (
              <div key={idx}>
                <div
                  className={styles.outlineItem}
                  style={{ alignItems: 'center', display: 'flex', gap: 4 }}
                >
                  {item.children && item.children.length > 0 ? (
                    expandedSections.has(idx) ? (
                      <ChevronDown
                        onClick={() => {
                          const next = new Set(expandedSections);
                          next.delete(idx);
                          setExpandedSections(next);
                        }}
                        size={14}
                        style={{ cursor: 'pointer' }}
                      />
                    ) : (
                      <ChevronRight
                        onClick={() => {
                          const next = new Set(expandedSections);
                          next.add(idx);
                          setExpandedSections(next);
                        }}
                        size={14}
                        style={{ cursor: 'pointer' }}
                      />
                    )
                  ) : (
                    <span style={{ width: 14 }} />
                  )}
                  {editingOutlineIdx === idx ? (
                    <Flexbox gap={4} horizontal style={{ flex: 1 }}>
                      <Input
                        onChange={(e) => setEditingText(e.target.value)}
                        onPressEnter={() => handleSaveOutlineEdit(idx)}
                        size="small"
                        value={editingText}
                      />
                      <Button
                        onClick={() => handleSaveOutlineEdit(idx)}
                        size="small"
                        type="primary"
                      >
                        ✓
                      </Button>
                      <Button
                        onClick={() => {
                          setEditingOutlineIdx(null);
                          setEditingText('');
                        }}
                        size="small"
                      >
                        <X size={10} />
                      </Button>
                    </Flexbox>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{item.title}</span>
                      {phase === 'outline' && (
                        <Flexbox gap={2} horizontal>
                          <Tooltip title="Sửa">
                            <Button
                              icon={<Pencil size={10} />}
                              onClick={() => {
                                setEditingOutlineIdx(idx);
                                setEditingText(item.title);
                              }}
                              size="small"
                              type="text"
                            />
                          </Tooltip>
                          <Tooltip title="Lên">
                            <Button
                              disabled={idx === 0}
                              icon={<ArrowUp size={10} />}
                              onClick={() => handleMoveOutlineItem(idx, 'up')}
                              size="small"
                              type="text"
                            />
                          </Tooltip>
                          <Tooltip title="Xuống">
                            <Button
                              disabled={idx === outline.length - 1}
                              icon={<ArrowDown size={10} />}
                              onClick={() => handleMoveOutlineItem(idx, 'down')}
                              size="small"
                              type="text"
                            />
                          </Tooltip>
                          <Tooltip title="Xóa">
                            <Button
                              danger
                              icon={<Trash2 size={10} />}
                              onClick={() => handleDeleteOutlineItem(idx)}
                              size="small"
                              type="text"
                            />
                          </Tooltip>
                        </Flexbox>
                      )}
                    </>
                  )}
                </div>
                {item.children && expandedSections.has(idx) && (
                  <div style={{ paddingLeft: 28 }}>
                    {item.children.map((child, ci) => (
                      <div className={styles.outlineItem} key={ci} style={{ fontSize: 12 }}>
                        {child.title}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Flexbox>
      )}

      {/* ────── PHASE: ARTICLE (streaming) ────── */}
      {phase === 'article' && (
        <Flexbox gap={12}>
          <Flexbox
            align={'center'}
            gap={8}
            horizontal
            style={{ background: 'rgba(100,102,241,0.08)', borderRadius: 8, padding: '10px 16px' }}
          >
            <Spin size="small" />
            <span style={{ fontSize: 14, fontWeight: 600 }}>✍️ Đang viết bài tổng quan...</span>
            {article.length > 0 && (
              <Tag color="blue" style={{ fontSize: 11 }}>
                {article.split(/\s+/).length} từ
              </Tag>
            )}
          </Flexbox>
          {articleWaitLong && article.length === 0 && (
            <div
              style={{
                background: 'rgba(250,204,21,0.08)',
                border: '1px solid rgba(250,204,21,0.2)',
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.6,
                padding: '10px 14px',
              }}
            >
              ⏳ <strong>Quá trình viết bài có thể mất 1–3 phút.</strong> Bạn có thể đóng panel này
              và làm việc khác — bài viết sẽ tự động hoàn thành và hiển thị khi bạn quay lại.
            </div>
          )}
          {article.length > 0 && (
            <div
              style={{
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                maxHeight: 400,
                overflowY: 'auto',
                padding: '12px 16px',
              }}
            >
              <pre
                style={{
                  fontSize: 12,
                  lineHeight: 1.6,
                  margin: 0,
                  opacity: 0.85,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {article.slice(-2000)}
              </pre>
            </div>
          )}
        </Flexbox>
      )}

      {/* ────── PHASE: DONE ────── */}
      {phase === 'done' && article && (
        <Flexbox gap={12}>
          <Flexbox gap={8} horizontal style={{ flexWrap: 'wrap' }}>
            <Dropdown
              menu={{
                items: [
                  { key: 'md', label: '📄 Markdown (.md)', onClick: handleDownloadMd },
                  { key: 'html', label: '🌐 HTML (.html)', onClick: handleDownloadHtml },
                  { key: 'pdf', label: '🖨️ In / PDF', onClick: handlePrintPdf },
                  { type: 'divider' as const },
                  {
                    key: 'bib',
                    label: '📚 BibTeX (.bib) - Zotero/Mendeley',
                    onClick: handleExportBibtex,
                  },
                  { key: 'ris', label: '📚 RIS (.ris) - EndNote', onClick: handleExportRis },
                ],
              }}
            >
              <Button icon={<Download size={14} />}>Tải xuống ▾</Button>
            </Dropdown>
            <Tooltip title="Sao chép Markdown vào clipboard">
              <Button icon={<ClipboardCopy size={14} />} onClick={handleCopy}>
                Sao chép
              </Button>
            </Tooltip>
            <Button icon={<RefreshCw size={14} />} onClick={handleReset}>
              Nghiên cứu mới
            </Button>
            {pubmedPapers.length > 0 && (
              <Button
                icon={<FileText size={14} />}
                onClick={() => setShowPrisma(!showPrisma)}
                type={showPrisma ? 'primary' : 'default'}
              >
                PRISMA Flow
              </Button>
            )}
            <Button
              icon={<FileText size={14} />}
              loading={isGeneratingGrade}
              onClick={() => setShowGrade(!showGrade)}
              type={showGrade ? 'primary' : 'default'}
            >
              {isGeneratingGrade
                ? 'Đang tạo...'
                : `📊 GRADE${gradeData.length > 0 ? ` (${gradeData.length})` : ''}`}
            </Button>
            {pubmedPapers.length > 0 && (
              <Button
                icon={<FileText size={14} />}
                onClick={() => setShowNetwork(!showNetwork)}
                type={showNetwork ? 'primary' : 'default'}
              >
                🔗 Citation Network
              </Button>
            )}
          </Flexbox>

          {/* GRADE Evidence Quality Table */}
          {showGrade && (
            <Flexbox
              gap={8}
              style={{
                background: 'rgba(234,179,8,0.04)',
                border: '1px solid rgba(234,179,8,0.15)',
                borderRadius: 10,
                padding: '12px 16px',
              }}
            >
              <Flexbox align={'center'} gap={6} horizontal>
                <span style={{ fontSize: 14, fontWeight: 700 }}>📊 GRADE Evidence Quality</span>
                <Tag color="gold" style={{ fontSize: 10 }}>
                  Evidence Assessment
                </Tag>
              </Flexbox>
              {gradeData.length === 0 ? (
                <div
                  style={{
                    color: 'rgba(255,255,255,0.5)',
                    fontSize: 13,
                    padding: '12px 0',
                    textAlign: 'center',
                  }}
                >
                  {isGeneratingGrade
                    ? '⏳ Đang đánh giá chất lượng bằng chứng...'
                    : 'Chưa có dữ liệu GRADE'}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)' }}>
                        {[
                          'Outcome',
                          'Study Design',
                          'Risk of Bias',
                          'Inconsistency',
                          'Indirectness',
                          'Imprecision',
                          'Quality',
                        ].map((h) => (
                          <th
                            key={h}
                            style={{
                              fontWeight: 700,
                              padding: '6px 8px',
                              textAlign: 'left',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gradeData.map((row, i) => {
                        const qc =
                          GRADE_QUALITY_COLORS[row.overallQuality] ||
                          GRADE_QUALITY_COLORS['Very Low'];
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <td style={{ fontWeight: 600, maxWidth: 200, padding: '6px 8px' }}>
                              {row.outcome}
                            </td>
                            <td style={{ padding: '6px 8px' }}>{row.studyDesign}</td>
                            <td
                              style={{
                                color: row.riskOfBias?.toLowerCase().includes('serious')
                                  ? '#f97316'
                                  : '#22c55e',
                                padding: '6px 8px',
                              }}
                            >
                              {row.riskOfBias}
                            </td>
                            <td
                              style={{
                                color: row.inconsistency?.toLowerCase().includes('serious')
                                  ? '#f97316'
                                  : '#22c55e',
                                padding: '6px 8px',
                              }}
                            >
                              {row.inconsistency}
                            </td>
                            <td
                              style={{
                                color: row.indirectness?.toLowerCase().includes('serious')
                                  ? '#f97316'
                                  : '#22c55e',
                                padding: '6px 8px',
                              }}
                            >
                              {row.indirectness}
                            </td>
                            <td
                              style={{
                                color: row.imprecision?.toLowerCase().includes('serious')
                                  ? '#f97316'
                                  : '#22c55e',
                                padding: '6px 8px',
                              }}
                            >
                              {row.imprecision}
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <span
                                style={{
                                  background: qc.bg,
                                  borderRadius: 6,
                                  color: qc.text,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {qc.emoji} {row.overallQuality}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Flexbox>
          )}

          {/* Citation Network */}
          {showNetwork && pubmedPapers.length > 0 && (
            <Flexbox
              gap={8}
              style={{
                background: 'rgba(59,130,246,0.04)',
                border: '1px solid rgba(59,130,246,0.15)',
                borderRadius: 10,
                padding: '12px 16px',
              }}
            >
              <Flexbox align={'center'} gap={6} horizontal>
                <span style={{ fontSize: 14, fontWeight: 700 }}>🔗 Citation Network</span>
                <Tag color="cyan" style={{ fontSize: 10 }}>
                  References
                </Tag>
              </Flexbox>
              <div style={{ display: 'grid', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
                {pubmedPapers.slice(0, 10).map((p) => {
                  const pid = p.pmid || p.title.slice(0, 30);
                  const isExpanded = expandedNetworkNode === pid;
                  const refs = networkData[pid];
                  const isLoading = loadingNetwork === pid;
                  return (
                    <div
                      key={pid}
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 6 }}
                    >
                      <div
                        onClick={() => fetchReferences(pid)}
                        style={{
                          alignItems: 'center',
                          cursor: 'pointer',
                          display: 'flex',
                          fontSize: 12,
                          gap: 6,
                        }}
                      >
                        <span style={{ color: '#3b82f6', fontSize: 10, width: 12 }}>
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        <Tag
                          color={p.source === 'semantic_scholar' ? 'purple' : 'blue'}
                          style={{ fontSize: 8 }}
                        >
                          {p.source === 'semantic_scholar' ? 'S2' : 'PM'}
                        </Tag>
                        <span style={{ flex: 1, fontWeight: 500 }}>
                          {p.title.slice(0, 80)}
                          {p.title.length > 80 ? '...' : ''}
                        </span>
                        {p.citationCount ? (
                          <Tag style={{ fontSize: 8 }}>📝 {p.citationCount}</Tag>
                        ) : null}
                      </div>
                      {isExpanded && (
                        <div
                          style={{
                            borderLeft: '2px solid rgba(59,130,246,0.2)',
                            marginLeft: 16,
                            marginTop: 4,
                            paddingLeft: 10,
                          }}
                        >
                          {isLoading ? (
                            <div
                              style={{
                                color: 'rgba(255,255,255,0.4)',
                                fontSize: 11,
                                padding: '4px 0',
                              }}
                            >
                              ⏳ Đang tải references...
                            </div>
                          ) : refs && refs.length > 0 ? (
                            refs.map((r: NetworkRef) => (
                              <a
                                href={r.url}
                                key={r.paperId}
                                rel="noreferrer"
                                style={{
                                  color: '#60a5fa',
                                  display: 'block',
                                  fontSize: 11,
                                  padding: '2px 0',
                                  textDecoration: 'none',
                                }}
                                target="_blank"
                              >
                                {r.title.slice(0, 70)}
                                {r.title.length > 70 ? '...' : ''}
                                {r.year ? ` (${r.year})` : ''}
                                {r.citationCount > 0 ? ` • ${r.citationCount} citations` : ''}
                              </a>
                            ))
                          ) : refs ? (
                            <div
                              style={{
                                color: 'rgba(255,255,255,0.4)',
                                fontSize: 11,
                                padding: '4px 0',
                              }}
                            >
                              Không tìm thấy references
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Flexbox>
          )}

          {/* PRISMA Flowchart */}
          {showPrisma && (
            <Flexbox
              gap={8}
              style={{
                background: 'rgba(100,102,241,0.06)',
                border: '1px solid rgba(100,102,241,0.15)',
                borderRadius: 10,
                padding: '12px 16px',
              }}
            >
              <Flexbox align={'center'} gap={6} horizontal>
                <FileText size={14} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>PRISMA Flow Diagram</span>
                <Tag color="purple" style={{ fontSize: 10 }}>
                  Systematic Review
                </Tag>
              </Flexbox>
              {(() => {
                const pd = generatePrismaData();
                return (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {/* Visual flowchart as styled boxes */}
                    <div
                      style={{
                        alignItems: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          background: '#4f46e5',
                          borderRadius: 8,
                          color: 'white',
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '8px 16px',
                          textAlign: 'center',
                          width: '80%',
                        }}
                      >
                        Records identified: {pd.totalIdentified} papers (PubMed)
                      </div>
                      <span style={{ color: '#666', fontSize: 16 }}>▼</span>
                      <div
                        style={{
                          background: '#7c3aed',
                          borderRadius: 8,
                          color: 'white',
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '8px 16px',
                          textAlign: 'center',
                          width: '80%',
                        }}
                      >
                        Screened by {pd.agentsDone} AI Research Agents
                      </div>
                      <span style={{ color: '#666', fontSize: 16 }}>▼</span>
                      <div
                        style={{
                          background: '#2563eb',
                          borderRadius: 8,
                          color: 'white',
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '8px 16px',
                          textAlign: 'center',
                          width: '80%',
                        }}
                      >
                        Citations extracted: {pd.totalCitations} unique citations
                      </div>
                      <div
                        style={{ display: 'flex', gap: 8, justifyContent: 'center', width: '80%' }}
                      >
                        <div
                          style={{
                            background: '#16a34a',
                            borderRadius: 8,
                            color: 'white',
                            flex: 1,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '6px 12px',
                            textAlign: 'center',
                          }}
                        >
                          {pd.isVerifying
                            ? '⏳ Đang xác minh...'
                            : `✅ Verified: ${pd.verifiedCount}`}
                        </div>
                        <div
                          style={{
                            background: '#d97706',
                            borderRadius: 8,
                            color: 'white',
                            flex: 1,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '6px 12px',
                            textAlign: 'center',
                          }}
                        >
                          {pd.isVerifying ? '⏳ Chờ...' : `⚠️ Unverified: ${pd.unverifiedCount}`}
                        </div>
                      </div>
                      <span style={{ color: '#666', fontSize: 16 }}>▼</span>
                      <div
                        style={{
                          background: '#059669',
                          borderRadius: 8,
                          color: 'white',
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '8px 16px',
                          textAlign: 'center',
                          width: '80%',
                        }}
                      >
                        Article synthesized: {pd.outlineSections} sections
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Flexbox>
          )}

          {/* Citation Verification */}
          {(citationResults.length > 0 || isVerifying) && (
            <Flexbox
              gap={6}
              style={{ background: 'rgba(0,0,0,0.02)', borderRadius: 8, padding: '8px 12px' }}
            >
              <Flexbox align={'center'} gap={8} horizontal>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Xác minh Citations</span>
                {isVerifying ? (
                  <Tag color="processing" icon={<Loader2 className="animate-spin" size={10} />}>
                    Đang kiểm tra...
                  </Tag>
                ) : citationResults.length > 0 ? (
                  <Tag
                    color={
                      citationResults.filter((r) => r.status === 'verified').length /
                        citationResults.length >
                      0.5
                        ? 'success'
                        : 'warning'
                    }
                  >
                    {citationResults.filter((r) => r.status === 'verified').length}/
                    {citationResults.length} tìm thấy trên PubMed (
                    {Math.round(
                      (citationResults.filter((r) => r.status === 'verified').length /
                        citationResults.length) *
                        100,
                    )}
                    %)
                  </Tag>
                ) : null}
              </Flexbox>
              {citationResults.length > 0 && (
                <div style={{ display: 'grid', gap: 3 }}>
                  {citationResults.map((cr, i) => (
                    <Flexbox align={'center'} gap={6} horizontal key={i} style={{ fontSize: 11 }}>
                      <Tag
                        color={cr.status === 'verified' ? 'success' : 'warning'}
                        style={{ fontSize: 10 }}
                      >
                        {cr.status === 'verified' ? 'V' : '?'}
                      </Tag>
                      <span style={{ fontWeight: 500 }}>{cr.citation}</span>
                      {cr.status === 'verified' && cr.pmid && (
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${cr.pmid}/`}
                          rel="noreferrer"
                          style={{ color: '#1890ff', fontSize: 10 }}
                          target="_blank"
                        >
                          PMID: {cr.pmid}
                        </a>
                      )}
                      {cr.status === 'unverified' && (
                        <span style={{ color: '#999', fontSize: 10 }}>
                          Không tìm thấy trên PubMed
                        </span>
                      )}
                    </Flexbox>
                  ))}
                </div>
              )}
            </Flexbox>
          )}

          {/* Follow-up refinement */}
          <Flexbox gap={4}>
            <Flexbox gap={8} horizontal>
              <Input
                disabled={isRefining}
                onChange={(e) => setRefinePrompt(e.target.value)}
                onPressEnter={handleRefine}
                placeholder="Tinh chỉnh: 'Mở rộng phần Discussion', 'Thêm so sánh với X'..."
                prefix={<MessageSquare size={14} />}
                style={{ flex: 1 }}
                value={refinePrompt}
              />
              <Button
                disabled={!refinePrompt.trim() || isRefining}
                icon={
                  isRefining ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )
                }
                loading={isRefining}
                onClick={handleRefine}
                type="primary"
              >
                Tinh chỉnh
              </Button>
            </Flexbox>
          </Flexbox>

          <div className={styles.article}>
            <Markdown>{article}</Markdown>
          </div>
        </Flexbox>
      )}
    </Flexbox>
  );
});

DeepResearchBody.displayName = 'DeepResearchBody';
export default DeepResearchBody;
