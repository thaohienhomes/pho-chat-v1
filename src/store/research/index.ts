/**
 * Research Mode — Zustand Store
 * Manages the state for the 5-phase medical research workflow.
 * Phase A: Discovery (search, PICO, papers)
 * Phase B: Screening (include/exclude papers, criteria)
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { type DetectedLanguage, buildSearchQuery } from '@/utils/research/buildSearchQuery';
import { extractPICO as llmExtractPICO } from '@/utils/research/extractPICO';

// ========== Types ==========

export interface PaperResult {
  abstract?: string;
  authors: string;
  citations?: number;
  doi?: string;
  doiUrl?: string;
  id: string;
  isOpenAccess?: boolean;
  journal?: string;
  pmid?: string;
  pubmedUrl?: string;
  source: 'PubMed' | 'OpenAlex' | 'ArXiv' | 'ClinicalTrials.gov';
  title: string;
  url?: string;
  year: number;
}

export interface PICOQuery {
  comparison: string;
  intervention: string;
  outcome: string;
  population: string;
}

// ========== AI helper (translate + PICO) ==========
//
// Hardcoded to a small/cheap deterministic model — translate quality must be
// stable across users (free tier, paid tier, custom keys).
const TRANSLATE_MODEL = 'gpt-4o-mini';

// Calls /api/research/ai-summary which is Clerk-authenticated and has full
// billing/tier enforcement. Phase 1.5 used /api/chat/direct, but that endpoint
// does not exist in this repo — every translate/PICO call silently fell back
// to the original VN query. Phase 1.5.1 fixes this by routing to the same
// endpoint Deep Research already uses successfully.
const callAI = async (model: string, prompt: string): Promise<string> => {
  const res = await fetch('/api/research/ai-summary', {
    body: JSON.stringify({ model, prompt, stream: false }),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (res.status === 401) {
    throw new Error('Unauthorized – please sign in to use Research Mode AI features');
  }
  if (res.status === 402 || res.status === 403) {
    throw new Error('Insufficient credits or plan tier');
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`AI call failed (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  // ai-summary returns { model, provider, text }
  return data?.text ?? '';
};

export type ResearchPhase = 'discovery' | 'screening' | 'analysis' | 'writing' | 'publishing';

export type SearchSource = 'PubMed' | 'OpenAlex' | 'ArXiv' | 'ClinicalTrials.gov';

export type ScreeningDecision = 'included' | 'excluded' | 'pending';

export interface ScreeningEntry {
  decision: ScreeningDecision;
  paperId: string;
  reason?: string;
}

export interface ScreeningCriteria {
  exclusionCriteria: string[];
  inclusionCriteria: string[];
  minCitations?: number;
  studyTypes?: string[];
  yearFrom?: number;
  yearTo?: number;
}

interface ResearchState {
  // Phase tracking
  activePhase: ResearchPhase;

  addPaper: (paper: PaperResult) => void;
  addPapers: (papers: PaperResult[]) => void;
  autoScreenByCitations: (minCitations: number) => void;
  autoScreenByYearRange: (yearFrom: number, yearTo: number) => void;
  // Pagination (MED-33)
  currentPage: number;
  // Translation context (Phase 1.5)
  detectedLanguage: DetectedLanguage | null;
  excludeAllPapers: () => void;
  extractPICO: (query: string) => Promise<void>;

  getExcludedPapers: () => PaperResult[];
  // Getters
  getIncludedPapers: () => PaperResult[];

  getPendingPapers: () => PaperResult[];
  getScreeningStats: () => { excluded: number; included: number; pending: number; total: number };
  hasMore: boolean;
  includeAllPapers: () => void;
  isLoadingMore: boolean;

  isSearching: boolean;
  loadMoreResults: () => Promise<void>;
  // Gate state (Phase 1.5): true when last search returned 0 papers from all sources.
  noPapersFound: boolean;
  papers: PaperResult[];
  pico: PICOQuery | null;
  removePapers: (ids: string[]) => void;
  reset: () => void;
  resetScreening: () => void;

  // Screening Actions
  screenPaper: (paperId: string, decision: ScreeningDecision, reason?: string) => void;
  screeningCriteria: ScreeningCriteria;
  // Screening
  screeningDecisions: Record<string, ScreeningEntry>;
  searchError: string | null;
  searchPapers: (query: string) => Promise<void>;
  // Discovery
  searchQuery: string;
  selectedSources: SearchSource[];

  setActivePhase: (phase: ResearchPhase) => void;
  // Discovery Actions
  setSearchQuery: (query: string) => void;
  toggleSource: (source: SearchSource) => void;
  totalResults: number;
  // English search query actually sent to PubMed/OpenAlex/etc when input was VN.
  translatedQuery: string | null;

  updateScreeningCriteria: (criteria: Partial<ScreeningCriteria>) => void;
}

const defaultCriteria: ScreeningCriteria = {
  exclusionCriteria: ['Case reports', 'Animal studies', 'Non-English language'],
  inclusionCriteria: ['Randomized controlled trial', 'Systematic review', 'Meta-analysis'],
  minCitations: 0,
  studyTypes: ['RCT', 'Systematic Review', 'Meta-analysis', 'Cohort Study'],
  yearFrom: 2015,
  yearTo: new Date().getFullYear(),
};

const initialState = {
  activePhase: 'discovery' as ResearchPhase,
  currentPage: 1,
  detectedLanguage: null as DetectedLanguage | null,
  hasMore: true,
  isLoadingMore: false,
  isSearching: false,
  noPapersFound: false,
  papers: [] as PaperResult[],
  pico: null as PICOQuery | null,
  screeningCriteria: defaultCriteria,
  screeningDecisions: {} as Record<string, ScreeningEntry>,
  searchError: null as string | null,
  searchQuery: '',
  // ArXiv default OFF — heavy CS bias polluted clinical results for our primary
  // user (BS Đỗ Tiến Sơn, endocrinology). Users can re-enable per search.
  selectedSources: ['PubMed', 'OpenAlex', 'ClinicalTrials.gov'] as SearchSource[],
  totalResults: 0,
  translatedQuery: null as string | null,
};

// ========== API Services ==========

// Phase 1.5.3 (Audit Finding #1) — emit telemetry whenever a search source
// fails so we can detect API outages (PubMed eutils, OpenAlex, etc) without
// relying on user complaints. Always paired with `return []` so the search
// continues with the remaining sources. The try/catch around posthog
// guarantees a missing analytics global never breaks the search path.
const captureSearchSourceFailed = (
  source: SearchSource,
  error: unknown,
  context: { query?: string; surface?: string },
) => {
  try {
    const errMsg = error instanceof Error ? error.message : String(error);
    (window as any).posthog?.capture('search_source_failed', {
      error: errMsg.slice(0, 200),
      query: (context.query || '').slice(0, 100),
      source,
      surface: context.surface || 'research_mode',
    });
  } catch {
    /* posthog not loaded — skip silently */
  }
};

const searchPubMed = async (query: string, maxResults = 10, offset = 0): Promise<PaperResult[]> => {
  try {
    const response = await fetch('/api/plugins/pubmed/search', {
      body: JSON.stringify({ maxResults, offset, query }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error('PubMed search failed');

    const data = await response.json();
    const articles = data.articles || [];
    return articles.map((a: any) => ({
      abstract: a.abstract,
      authors: (a.authors || []).join(', '),
      citations: undefined,
      doi: a.doi,
      doiUrl: a.doiUrl,
      id: `pubmed-${a.pmid}`,
      journal: a.journal,
      pubmedUrl: a.pubmedUrl,
      source: 'PubMed' as const,
      title: a.title,
      year: a.pubDate ? new Date(a.pubDate).getFullYear() : 0,
    }));
  } catch (error) {
    console.error('[Research] PubMed search error:', error);
    captureSearchSourceFailed('PubMed', error, { query, surface: 'research_mode' });
    return [];
  }
};

const searchOpenAlex = async (
  query: string,
  maxResults = 10,
  offset = 0,
): Promise<PaperResult[]> => {
  try {
    const response = await fetch('/api/plugins/openalex/search', {
      body: JSON.stringify({ maxResults, offset, query }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error('OpenAlex search failed');

    const data = await response.json();
    const articles = data.articles || [];
    return articles.map((a: any) => ({
      authors: a.firstAuthor || 'Unknown',
      citations: a.citedByCount,
      doi: a.doi,
      doiUrl: a.doiUrl,
      id: `openalex-${a.doi || a.title}`,
      isOpenAccess: a.isOpenAccess,
      journal: a.journal,
      source: 'OpenAlex' as const,
      title: a.title,
      year: a.year || 0,
    }));
  } catch (error) {
    console.error('[Research] OpenAlex search error:', error);
    captureSearchSourceFailed('OpenAlex', error, { query, surface: 'research_mode' });
    return [];
  }
};

const searchArXiv = async (query: string, maxResults = 10, offset = 0): Promise<PaperResult[]> => {
  try {
    const response = await fetch('/api/plugins/arxiv/search', {
      body: JSON.stringify({ maxResults, offset, query }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error('ArXiv search failed');

    const data = await response.json();
    const papers = data.papers || [];
    return papers.map((a: any) => ({
      abstract: a.abstract,
      authors: (a.authors || []).join(', '),
      citations: undefined,
      doi: a.doi,
      doiUrl: a.doi ? `https://doi.org/${a.doi}` : undefined,
      id: `arxiv-${a.arxivId}`,
      journal: `arXiv:${a.arxivId}`,
      pubmedUrl: `https://arxiv.org/abs/${a.arxivId}`,
      source: 'ArXiv' as const,
      title: a.title,
      year: a.published ? new Date(a.published).getFullYear() : 0,
    }));
  } catch (error) {
    console.error('[Research] ArXiv search error:', error);
    captureSearchSourceFailed('ArXiv', error, { query, surface: 'research_mode' });
    return [];
  }
};

// ========== ClinicalTrials.gov ==========

const searchClinicalTrials = async (
  query: string,
  maxResults = 10,
  offset = 0,
): Promise<PaperResult[]> => {
  try {
    const response = await fetch('/api/plugins/clinical-trials/search', {
      body: JSON.stringify({ maxResults, offset, query }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error('ClinicalTrials.gov search failed');

    const data = await response.json();
    const trials = data.trials || [];
    return trials.map((t: any) => ({
      abstract: [
        t.status ? `Status: ${t.status}` : '',
        t.phase && t.phase !== 'N/A' ? `Phase: ${t.phase}` : '',
        t.enrollmentCount ? `Enrollment: ${t.enrollmentCount} participants` : '',
        t.conditions?.length ? `Conditions: ${t.conditions.slice(0, 3).join(', ')}` : '',
        t.interventions?.length ? `Interventions: ${t.interventions.slice(0, 3).join(', ')}` : '',
        t.eligibility ? t.eligibility : '',
      ]
        .filter(Boolean)
        .join(' | '),
      authors: t.sponsor || 'Unknown sponsor',
      citations: t.enrollmentCount,
      doi: undefined,
      doiUrl: t.url,
      id: `ct-${t.nctId}`,
      journal: `ClinicalTrials.gov · ${t.nctId}`,
      pubmedUrl: t.url,
      source: 'ClinicalTrials.gov' as const,
      title: t.title,
      year: t.startDate ? new Date(t.startDate).getFullYear() : new Date().getFullYear(),
    }));
  } catch (error) {
    console.error('[Research] ClinicalTrials.gov search error:', error);
    captureSearchSourceFailed('ClinicalTrials.gov', error, { query, surface: 'research_mode' });
    return [];
  }
};

// ========== Store ==========

export const useResearchStore = create<ResearchState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        addPaper: (paper: PaperResult) => {
          const { papers, screeningDecisions } = get();
          // Avoid duplicates by id
          if (papers.some((p) => p.id === paper.id)) return;
          set(
            {
              papers: [paper, ...papers],
              // Auto-include the manually added paper
              screeningDecisions: {
                ...screeningDecisions,
                [paper.id]: {
                  decision: 'included',
                  paperId: paper.id,
                  reason: 'Manually added via DOI resolver',
                },
              },
              totalResults: papers.length + 1,
            },
            false,
            'addPaper',
          );
        },

        addPapers: (toAdd: PaperResult[]) => {
          const { papers, screeningDecisions } = get();
          const existingIds = new Set(papers.map((p) => p.id));
          const newPapers = toAdd.filter((p) => !existingIds.has(p.id));
          if (newPapers.length === 0) return;
          const newDecisions = { ...screeningDecisions };
          for (const p of newPapers) {
            newDecisions[p.id] = {
              decision: 'pending',
              paperId: p.id,
              reason: 'Imported via RIS/BibTeX',
            };
          }
          set(
            {
              papers: [...newPapers, ...papers],
              screeningDecisions: newDecisions,
              totalResults: papers.length + newPapers.length,
            },
            false,
            'addPapers',
          );
        },

        autoScreenByCitations: (minCitations) => {
          const { papers, screeningDecisions } = get();
          const updated = { ...screeningDecisions };
          for (const paper of papers) {
            if ((paper.citations || 0) < minCitations) {
              updated[paper.id] = {
                decision: 'excluded',
                paperId: paper.id,
                reason: `< ${minCitations} citations`,
              };
            }
          }
          set(
            {
              screeningCriteria: { ...get().screeningCriteria, minCitations },
              screeningDecisions: updated,
            },
            false,
            'autoScreenByCitations',
          );
        },

        autoScreenByYearRange: (yearFrom, yearTo) => {
          const { papers, screeningDecisions } = get();
          const updated = { ...screeningDecisions };
          for (const paper of papers) {
            if (paper.year < yearFrom || paper.year > yearTo) {
              updated[paper.id] = {
                decision: 'excluded',
                paperId: paper.id,
                reason: `Outside ${yearFrom}-${yearTo}`,
              };
            }
          }
          set(
            {
              screeningCriteria: { ...get().screeningCriteria, yearFrom, yearTo },
              screeningDecisions: updated,
            },
            false,
            'autoScreenByYearRange',
          );
        },

        excludeAllPapers: () => {
          const { papers } = get();
          const decisions: Record<string, ScreeningEntry> = {};
          for (const paper of papers) {
            decisions[paper.id] = { decision: 'excluded', paperId: paper.id };
          }
          set({ screeningDecisions: decisions }, false, 'excludeAllPapers');
        },

        extractPICO: async (query) => {
          // ARCHITECTURAL NOTE for v2 port: any LLM-derived metadata (PICO,
          // MeSH expansion, specialty hint, embeddings) MUST sequence AFTER
          // translate, not parallel. Pattern: translate() → derive_metadata()
          // → search().
          //
          // Phase 1.5.2 Bug E: previously read translatedQuery from state,
          // which was either null (first run, raced with searchPapers) or
          // STALE from a prior search. Now we call buildSearchQuery directly
          // — it is cache-friendly so this is a no-op when searchPapers
          // already translated the same input in the current session.
          let queryForExtraction = query;
          try {
            const queryInfo = await buildSearchQuery(query, callAI, TRANSLATE_MODEL);
            queryForExtraction = queryInfo.searchQuery;
          } catch (e) {
            console.warn('[extractPICO] translate failed, using raw query', e);
          }
          const result = await llmExtractPICO(queryForExtraction, callAI, TRANSLATE_MODEL);
          set({ pico: result.pico }, false, 'extractPICO');
        },

        getExcludedPapers: () => {
          const { papers, screeningDecisions } = get();
          return papers.filter((p) => screeningDecisions[p.id]?.decision === 'excluded');
        },

        getIncludedPapers: () => {
          const { papers, screeningDecisions } = get();
          return papers.filter((p) => screeningDecisions[p.id]?.decision === 'included');
        },

        getPendingPapers: () => {
          const { papers, screeningDecisions } = get();
          return papers.filter(
            (p) => !screeningDecisions[p.id] || screeningDecisions[p.id]?.decision === 'pending',
          );
        },

        getScreeningStats: () => {
          const { papers, screeningDecisions } = get();
          let included = 0;
          let excluded = 0;
          for (const paper of papers) {
            const d = screeningDecisions[paper.id]?.decision;
            if (d === 'included') included++;
            else if (d === 'excluded') excluded++;
          }
          return {
            excluded,
            included,
            pending: papers.length - included - excluded,
            total: papers.length,
          };
        },

        includeAllPapers: () => {
          const { papers } = get();
          const decisions: Record<string, ScreeningEntry> = {};
          for (const paper of papers) {
            decisions[paper.id] = { decision: 'included', paperId: paper.id };
          }
          set({ screeningDecisions: decisions }, false, 'includeAllPapers');
        },

        loadMoreResults: async () => {
          const {
            currentPage,
            isLoadingMore,
            searchQuery,
            selectedSources,
            papers,
            translatedQuery,
          } = get();
          if (isLoadingMore || !searchQuery) return;

          // Reuse the same English query as the initial search so
          // pagination doesn't suddenly switch to raw VN and return
          // unrelated results.
          const queryToUse = translatedQuery || searchQuery;
          const nextPage = currentPage + 1;
          const offset = currentPage * 10;
          set({ isLoadingMore: true }, false, 'loadMoreResults/start');

          try {
            const promises: Promise<PaperResult[]>[] = [];
            if (selectedSources.includes('PubMed'))
              promises.push(searchPubMed(queryToUse, 10, offset));
            if (selectedSources.includes('OpenAlex'))
              promises.push(searchOpenAlex(queryToUse, 10, offset));
            if (selectedSources.includes('ArXiv'))
              promises.push(searchArXiv(queryToUse, 10, offset));
            if (selectedSources.includes('ClinicalTrials.gov'))
              promises.push(searchClinicalTrials(queryToUse, 10, offset));

            const results = await Promise.allSettled(promises);
            const newPapers: PaperResult[] = [];
            const seenKeys = new Set(papers.map((p) => p.doi || p.title));

            for (const result of results) {
              if (result.status === 'fulfilled') {
                for (const paper of result.value) {
                  const key = paper.doi || paper.title;
                  if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    newPapers.push(paper);
                  }
                }
              }
            }

            const combined = [...papers, ...newPapers];
            combined.sort((a, b) => {
              if ((b.citations || 0) !== (a.citations || 0))
                return (b.citations || 0) - (a.citations || 0);
              return b.year - a.year;
            });

            set(
              {
                currentPage: nextPage,
                hasMore: newPapers.length >= 10,
                isLoadingMore: false,
                papers: combined,
                totalResults: combined.length,
              },
              false,
              'loadMoreResults/done',
            );
          } catch {
            set({ isLoadingMore: false }, false, 'loadMoreResults/error');
          }
        },

        removePapers: (ids: string[]) => {
          const { papers, screeningDecisions } = get();
          const removeSet = new Set(ids);
          const remaining = papers.filter((p) => !removeSet.has(p.id));
          const newDecisions = { ...screeningDecisions };
          for (const id of ids) delete newDecisions[id];
          set(
            {
              papers: remaining,
              screeningDecisions: newDecisions,
              totalResults: remaining.length,
            },
            false,
            'removePapers',
          );
        },

        reset: () => {
          set(initialState, false, 'reset');
        },

        resetScreening: () => {
          set({ screeningDecisions: {} }, false, 'resetScreening');
        },

        screenPaper: (paperId, decision, reason) => {
          const { screeningDecisions } = get();
          set(
            {
              screeningDecisions: {
                ...screeningDecisions,
                [paperId]: { decision, paperId, reason },
              },
            },
            false,
            'screenPaper',
          );
        },

        searchPapers: async (query) => {
          const { selectedSources } = get();
          set(
            {
              currentPage: 1,
              detectedLanguage: null,
              hasMore: true,
              isSearching: true,
              noPapersFound: false,
              searchError: null,
              searchQuery: query,
              translatedQuery: null,
            },
            false,
            'searchPapers/start',
          );

          try {
            // Step 1 — translate VN → EN (Bug A). EN/other passes through unchanged.
            const queryInfo = await buildSearchQuery(query, callAI, TRANSLATE_MODEL);
            const finalQuery = queryInfo.searchQuery;

            set(
              {
                detectedLanguage: queryInfo.detectedLanguage,
                translatedQuery: queryInfo.translated ? queryInfo.searchQuery : null,
              },
              false,
              'searchPapers/translated',
            );

            (window as any).posthog?.capture('research_query_translated', {
              detected_language: queryInfo.detectedLanguage,
              duration_ms: queryInfo.durationMs,
              fell_back_to_original: queryInfo.fellBackToOriginal,
              original_query: queryInfo.originalQuery.slice(0, 200),
              surface: 'research_mode',
              translated: queryInfo.translated,
              translated_query: queryInfo.searchQuery.slice(0, 200),
            });

            // Step 2 — fan out to selected sources using the (possibly translated) query.
            const sourceOrder: SearchSource[] = [
              'PubMed',
              'OpenAlex',
              'ArXiv',
              'ClinicalTrials.gov',
            ];
            const fetchers: Record<SearchSource, (_q: string) => Promise<PaperResult[]>> = {
              'ArXiv': (q) => searchArXiv(q),
              'ClinicalTrials.gov': (q) => searchClinicalTrials(q),
              'OpenAlex': (q) => searchOpenAlex(q),
              'PubMed': (q) => searchPubMed(q),
            };
            const usedSources = sourceOrder.filter((s) => selectedSources.includes(s));
            const results = await Promise.allSettled(
              usedSources.map((s) => fetchers[s](finalQuery)),
            );

            const allPapers: PaperResult[] = [];
            const seenKeys = new Set<string>();
            const sourceTracker: Record<string, number> = {};

            for (const [idx, source] of usedSources.entries()) {
              const result = results[idx];
              if (result?.status === 'fulfilled') {
                sourceTracker[source] = result.value.length;
                for (const paper of result.value) {
                  const key = paper.doi || paper.title;
                  if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    allPapers.push(paper);
                  }
                }
              } else {
                sourceTracker[source] = 0;
              }
            }

            allPapers.sort((a, b) => {
              if ((b.citations || 0) !== (a.citations || 0))
                return (b.citations || 0) - (a.citations || 0);
              return b.year - a.year;
            });

            const hasMore = allPapers.length >= 10;

            (window as any).posthog?.capture('research_papers_found', {
              detected_language: queryInfo.detectedLanguage,
              original_question: queryInfo.originalQuery.slice(0, 200),
              paper_count: allPapers.length,
              papers_per_source: sourceTracker,
              sources: Array.from(selectedSources),
              surface: 'research_mode',
              translated_query: queryInfo.searchQuery.slice(0, 200),
            });

            if (allPapers.length === 0) {
              set(
                {
                  hasMore: false,
                  isSearching: false,
                  noPapersFound: true,
                  papers: [],
                  screeningDecisions: {},
                  totalResults: 0,
                },
                false,
                'searchPapers/noPapers',
              );

              (window as any).posthog?.capture('research_no_papers', {
                original_question: queryInfo.originalQuery.slice(0, 200),
                sources: Array.from(selectedSources),
                surface: 'research_mode',
                translated_query: queryInfo.searchQuery.slice(0, 200),
              });
              return;
            }

            set(
              {
                hasMore,
                isSearching: false,
                noPapersFound: false,
                papers: allPapers,
                screeningDecisions: {},
                totalResults: allPapers.length,
              },
              false,
              'searchPapers/done',
            );
          } catch (e) {
            console.error('[searchPapers] error', e);
            set(
              { isSearching: false, searchError: 'Search failed. Please try again.' },
              false,
              'searchPapers/error',
            );
          }
        },

        setActivePhase: (phase) => set({ activePhase: phase }, false, 'setActivePhase'),
        setSearchQuery: (query) => set({ searchQuery: query }, false, 'setSearchQuery'),

        toggleSource: (source) => {
          const { selectedSources } = get();
          const newSources = selectedSources.includes(source)
            ? selectedSources.filter((s) => s !== source)
            : [...selectedSources, source];
          set({ selectedSources: newSources }, false, 'toggleSource');
        },

        updateScreeningCriteria: (criteria) => {
          set(
            { screeningCriteria: { ...get().screeningCriteria, ...criteria } },
            false,
            'updateScreeningCriteria',
          );
        },
      }),
      {
        migrate: (persistedState: any, fromVersion: number) => {
          // v0/v1 had ArXiv on by default for clinical queries.
          // v2 removes ArXiv from default to reduce CS-paper noise.
          // Only auto-migrate users who still have the legacy 4-source default;
          // preserve any explicit customization (added or removed sources).
          if (fromVersion < 2 && persistedState) {
            const oldSources: string[] = persistedState.selectedSources ?? [];
            const looksLikeLegacyDefault =
              oldSources.length === 4 &&
              oldSources.includes('PubMed') &&
              oldSources.includes('OpenAlex') &&
              oldSources.includes('ArXiv') &&
              oldSources.includes('ClinicalTrials.gov');
            if (looksLikeLegacyDefault) {
              return {
                ...persistedState,
                selectedSources: ['PubMed', 'OpenAlex', 'ClinicalTrials.gov'],
              };
            }
          }
          return persistedState;
        },
        name: 'pho-research-store',
        partialize: (state) => ({
          activePhase: state.activePhase,
          papers: state.papers,
          pico: state.pico,
          screeningCriteria: state.screeningCriteria,
          screeningDecisions: state.screeningDecisions,
          searchQuery: state.searchQuery,
          selectedSources: state.selectedSources,
          totalResults: state.totalResults,
        }),
        version: 2,
      },
    ),
    { name: 'ResearchStore' },
  ),
);
