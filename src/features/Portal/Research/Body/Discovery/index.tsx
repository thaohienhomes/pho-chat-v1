'use client';

import { Button, Input, Tag } from '@lobehub/ui';
import { InputNumber, Select, Slider, Spin } from 'antd';
import { createStyles } from 'antd-style';
import { ArrowRight, ExternalLink, Pencil, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { type SearchSource, useResearchStore } from '@/store/research';

import PdfUploader from './PdfUploader';

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
    errorMsg: css`
    padding: 12px 16px;

    font-size: 13px;
    color: ${token.colorError};

    background: ${token.colorErrorBg};
    border: 1px solid ${token.colorErrorBorder};
    border-radius: ${token.borderRadiusLG}px;
  `,
    filterLabel: css`
    font-size: 11px;
    font-weight: 600;
    color: ${token.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
    filterPanel: css`
    padding: 12px 14px;
    background: ${token.colorFillQuaternary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
  `,
    openAccess: css`
    padding: 1px 6px;

    font-size: 10px;
    font-weight: 600;
    color: ${token.colorSuccess};

    background: ${token.colorSuccessBg};
    border-radius: 4px;
  `,
    picoCard: css`
    padding: 16px;

    background: ${token.colorFillQuaternary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
  `,
    picoLabel: css`
    min-width: 80px;
    padding: 2px 8px;

    font-size: 11px;
    font-weight: 600;
    color: ${token.colorPrimary};
    text-transform: uppercase;

    background: ${token.colorPrimaryBg};
    border-radius: 4px;
  `,
    picoValue: css`
    font-size: 13px;
    color: ${token.colorText};
  `,
    resultAbstract: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorTextTertiary};
  `,
    resultAbstractToggle: css`
    cursor: pointer;

    font-size: 11px;
    font-weight: 500;
    color: ${token.colorPrimary};

    &:hover {
      text-decoration: underline;
    }
  `,
    resultCard: css`
    cursor: pointer;

    padding: 12px 16px;

    background: ${token.colorFillQuaternary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    transition: all 0.2s ease;

    &:hover {
      background: ${token.colorFillTertiary};
      border-color: ${token.colorPrimaryBorder};
    }
  `,
    resultMeta: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
    resultTitle: css`
    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
    color: ${token.colorText};
  `,
    sectionTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
}));

const SOURCES: SearchSource[] = ['PubMed', 'OpenAlex', 'ArXiv', 'ClinicalTrials.gov'];

const DiscoveryPhase = memo(() => {
    const { styles } = useStyles();

    const searchQuery = useResearchStore((s) => s.searchQuery);
    const selectedSources = useResearchStore((s) => s.selectedSources);
    const papers = useResearchStore((s) => s.papers);
    const pico = useResearchStore((s) => s.pico);
    const totalResults = useResearchStore((s) => s.totalResults);
    const isSearching = useResearchStore((s) => s.isSearching);
    const searchError = useResearchStore((s) => s.searchError);
    const noPapersFound = useResearchStore((s) => s.noPapersFound);
    const translatedQuery = useResearchStore((s) => s.translatedQuery);

    const setSearchQuery = useResearchStore((s) => s.setSearchQuery);
    const toggleSource = useResearchStore((s) => s.toggleSource);
    const searchPapers = useResearchStore((s) => s.searchPapers);
    const extractPICO = useResearchStore((s) => s.extractPICO);
    const setActivePhase = useResearchStore((s) => s.setActivePhase);
    const loadMoreResults = useResearchStore((s) => s.loadMoreResults);
    const hasMore = useResearchStore((s) => s.hasMore);
    const isLoadingMore = useResearchStore((s) => s.isLoadingMore);

    const focusSearchInput = useCallback(() => {
        const input = document.querySelector<HTMLInputElement>('input[placeholder*="câu hỏi"]');
        input?.focus();
    }, []);

    const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set());

    const toggleAbstract = useCallback((paperId: string) => {
        setExpandedAbstracts((prev) => {
            const next = new Set(prev);
            if (next.has(paperId)) next.delete(paperId);
            else next.add(paperId);
            return next;
        });
    }, []);

    const handleSearch = () => {
        if (searchQuery.trim()) {
            extractPICO(searchQuery);
            searchPapers(searchQuery);
        }
    };

    const handlePaperClick = (paper: (typeof papers)[0]) => {
        const url = paper.doiUrl || paper.pubmedUrl;
        if (url) window.open(url, '_blank');
    };

    const currentYear = new Date().getFullYear();

    // ── local state ──────────────────────────────────────────
    const [showFilters, setShowFilters] = useState(false);
    const [yearFrom, setYearFrom] = useState<number>(2000);
    const [yearTo, setYearTo] = useState<number>(currentYear);
    const [minCitations, setMinCitations] = useState<number>(0);
    const [studyType, setStudyType] = useState<string>('');

    // Active filter count badge
    const activeFilters = [
        yearFrom > 2000,
        yearTo < currentYear,
        minCitations > 0,
        studyType !== '',
    ].filter(Boolean).length;

    // ── filtered papers (client-side) ────────────────────────
    const filteredPapers = useMemo(() => {
        return papers.filter((p) => {
            if (p.year && (p.year < yearFrom || p.year > yearTo)) return false;
            if (minCitations > 0 && (p.citations ?? 0) < minCitations) return false;
            if (studyType) {
                const haystack = `${p.title} ${p.abstract ?? ''}`.toLowerCase();
                const typeMap: Record<string, string[]> = {
                    cohort: ['cohort', 'prospective', 'retrospective', 'longitudinal'],
                    cr: ['case report', 'case series'],
                    cross: ['cross-sectional', 'cross sectional', 'prevalence study', 'survey study'],
                    meta: ['meta-analysis', 'meta analysis', 'systematic review and meta'],
                    rct: ['randomized', 'randomised', 'rct', 'clinical trial', 'controlled trial'],
                    sr: ['systematic review', 'scoping review'],
                };
                const keywords = typeMap[studyType] ?? [];
                if (!keywords.some((kw) => haystack.includes(kw))) return false;
            }
            return true;
        });
    }, [papers, yearFrom, yearTo, minCitations, studyType]);

    const resetFilters = () => {
        setYearFrom(2000);
        setYearTo(currentYear);
        setMinCitations(0);
        setStudyType('');
    };

    return (
        <Flexbox className={styles.container} gap={16}>
            {/* Search Input */}
            <Flexbox gap={8}>
                <Input
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onPressEnter={handleSearch}
                    placeholder="Nhập câu hỏi nghiên cứu (VD: metformin diabetes prevention)..."
                    prefix={<Search size={16} />}
                    size="large"
                    value={searchQuery}
                />
                <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
                    <Flexbox gap={6} horizontal wrap={'wrap'}>
                        {SOURCES.map((source) => (
                            <Tag
                                color={selectedSources.includes(source) ? 'processing' : undefined}
                                key={source}
                                onClick={() => toggleSource(source)}
                                style={{ cursor: 'pointer' }}
                            >
                                {selectedSources.includes(source) ? '✓ ' : ''}
                                {source}
                            </Tag>
                        ))}
                    </Flexbox>
                    <Flexbox gap={6} horizontal>
                        <Button
                            icon={<SlidersHorizontal size={13} />}
                            onClick={() => setShowFilters((v) => !v)}
                            size={'small'}
                            type={showFilters ? 'primary' : 'default'}
                        >
                            Bộ lọc{activeFilters > 0 ? ` (${activeFilters})` : ''}
                        </Button>
                        <Button
                            loading={isSearching}
                            onClick={handleSearch}
                            size={'small'}
                            type={'primary'}
                        >
                            Tìm kiếm
                        </Button>
                    </Flexbox>
                </Flexbox>

                {/* Filter Panel */}
                {showFilters && (
                    <div className={styles.filterPanel}>
                        <Flexbox gap={12}>
                            {/* Year range */}
                            <Flexbox gap={4}>
                                <Flexbox align={'center'} horizontal justify={'space-between'}>
                                    <span className={styles.filterLabel}>Năm công bố</span>
                                    <span style={{ fontSize: 11, opacity: 0.6 }}>{yearFrom} – {yearTo}</span>
                                </Flexbox>
                                <Slider
                                    max={currentYear}
                                    min={1990}
                                    onChange={(val: number[]) => { setYearFrom(val[0]); setYearTo(val[1]); }}
                                    range
                                    style={{ margin: '0 4px' }}
                                    value={[yearFrom, yearTo]}
                                />
                            </Flexbox>

                            <Flexbox gap={10} horizontal wrap={'wrap'}>
                                {/* Min citations */}
                                <Flexbox gap={4} style={{ minWidth: 140 }}>
                                    <span className={styles.filterLabel}>Trích dẫn tối thiểu</span>
                                    <InputNumber
                                        min={0}
                                        onChange={(v) => setMinCitations(v ?? 0)}
                                        placeholder="0"
                                        size={'small'}
                                        step={10}
                                        style={{ width: '100%' }}
                                        value={minCitations}
                                    />
                                </Flexbox>

                                {/* Study type */}
                                <Flexbox gap={4} style={{ flex: 1, minWidth: 160 }}>
                                    <span className={styles.filterLabel}>Loại nghiên cứu</span>
                                    <Select
                                        allowClear
                                        onChange={(v) => setStudyType(v ?? '')}
                                        options={[
                                            { label: 'Thử nghiệm lâm sàng ngẫu nhiên có đối chứng (RCT)', value: 'rct' },
                                            { label: 'Tổng quan hệ thống (Systematic Review)', value: 'sr' },
                                            { label: 'Phân tích tổng hợp (Meta-analysis)', value: 'meta' },
                                            { label: 'Nghiên cứu thuần tập (Cohort Study)', value: 'cohort' },
                                            { label: 'Nghiên cứu cắt ngang (Cross-sectional)', value: 'cross' },
                                            { label: 'Báo cáo ca bệnh (Case Report/Series)', value: 'cr' },
                                        ]}
                                        placeholder="Tất cả loại"
                                        size={'small'}
                                        value={studyType || undefined}
                                    />
                                </Flexbox>
                            </Flexbox>

                            {activeFilters > 0 && (
                                <Button onClick={resetFilters} size={'small'} style={{ alignSelf: 'flex-start', padding: 0 }} type={'link'}>
                                    ✕ Xóa bộ lọc
                                </Button>
                            )}
                        </Flexbox>
                    </div>
                )}
            </Flexbox>

            {/* Loading state */}
            {isSearching && (
                <Flexbox align={'center'} justify={'center'} style={{ padding: 32 }}>
                    <Spin size="large" tip="Đang tìm kiếm từ PubMed, OpenAlex..." />
                </Flexbox>
            )}

            {/* Error state */}
            {searchError && <div className={styles.errorMsg}>⚠️ {searchError}</div>}

            {/* PICO Card */}
            {pico && !isSearching && (
                <Flexbox gap={8}>
                    <span className={styles.sectionTitle}>🎯 PICO Framework Analysis</span>
                    <div className={styles.picoCard}>
                        <Flexbox gap={8}>
                            {[
                                { label: 'Population (P)', value: pico.population },
                                { label: 'Intervention (I)', value: pico.intervention },
                                { label: 'Comparison (C)', value: pico.comparison },
                                { label: 'Outcome (O)', value: pico.outcome },
                            ].map((item) => (
                                <Flexbox align={'center'} gap={12} horizontal key={item.label}>
                                    <span className={styles.picoLabel}>{item.label}</span>
                                    <span className={styles.picoValue}>{item.value}</span>
                                </Flexbox>
                            ))}
                        </Flexbox>
                    </div>
                </Flexbox>
            )}

            {/* No-papers gate (Phase 1.5) — surfaced when search succeeded with 0 results */}
            {noPapersFound && !isSearching && (
                <Flexbox
                    gap={8}
                    style={{
                        background: 'rgba(234,179,8,0.08)',
                        border: '1px solid rgba(234,179,8,0.4)',
                        borderRadius: 8,
                        marginTop: 4,
                        padding: 12,
                    }}
                >
                    <Flexbox align={'center'} gap={8} horizontal>
                        <span style={{ fontSize: 18 }}>⚠️</span>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>
                            Không tìm thấy bài báo phù hợp
                        </span>
                    </Flexbox>
                    <span style={{ color: '#888', fontSize: 12, lineHeight: 1.55 }}>
                        Cả {selectedSources.join(', ')} đều không trả về bài báo cho truy vấn này.
                        {translatedQuery && (
                            <>
                                {' '}Đã dịch sang tiếng Anh: <code>{translatedQuery}</code>.
                            </>
                        )}
                        {' '}Việc viết bài tổng quan không có y văn sẽ không có trích dẫn xác thực và{' '}
                        <strong>không khuyến nghị cho mục đích lâm sàng</strong>.
                    </span>
                    <Flexbox gap={6} horizontal style={{ flexWrap: 'wrap' }}>
                        <Button
                            icon={<Pencil size={12} />}
                            onClick={focusSearchInput}
                            size={'small'}
                            type={'primary'}
                        >
                            Tinh chỉnh câu hỏi
                        </Button>
                        <Button
                            icon={<RefreshCw size={12} />}
                            onClick={() => searchQuery && searchPapers(searchQuery)}
                            size={'small'}
                        >
                            Thử lại
                        </Button>
                        <Button
                            icon={<SlidersHorizontal size={12} />}
                            onClick={() => setShowFilters(true)}
                            size={'small'}
                        >
                            Đổi nguồn
                        </Button>
                    </Flexbox>
                </Flexbox>
            )}

            {/* Search Results */}
            {papers.length > 0 && !isSearching && (
                <Flexbox gap={8}>
                    <Flexbox align={'center'} horizontal justify={'space-between'} wrap={'wrap'}>
                        <span className={styles.sectionTitle}>
                            📄 Kết quả tìm kiếm ({filteredPapers.length}
                            {filteredPapers.length !== totalResults ? ` / ${totalResults}` : ''} papers)
                            {translatedQuery && (
                                <span style={{ color: '#888', fontSize: 11, fontWeight: 400, marginLeft: 8 }}>
                                    🌐 Tìm bằng: <code>{translatedQuery}</code>
                                </span>
                            )}
                        </span>
                        {filteredPapers.length !== totalResults && (
                            <span style={{ fontSize: 11, opacity: 0.6 }}>Đang lọc — {totalResults - filteredPapers.length} ẩn</span>
                        )}
                    </Flexbox>
                    {filteredPapers.map((paper) => (
                        <div
                            className={styles.resultCard}
                            key={paper.id}
                            onClick={() => handlePaperClick(paper)}
                        >
                            <Flexbox gap={6}>
                                <Flexbox align={'flex-start'} gap={8} horizontal justify={'space-between'}>
                                    <span className={styles.resultTitle}>{paper.title}</span>
                                    {(paper.doiUrl || paper.pubmedUrl) && (
                                        <ExternalLink size={14} style={{ flexShrink: 0, marginTop: 3, opacity: 0.5 }} />
                                    )}
                                </Flexbox>
                                <span className={styles.resultMeta}>{paper.authors}</span>
                                {/* Abstract */}
                                {paper.abstract && (
                                    <Flexbox gap={2}>
                                        <span className={styles.resultAbstract}>
                                            {expandedAbstracts.has(paper.id)
                                                ? paper.abstract
                                                : paper.abstract.length > 200
                                                    ? `${paper.abstract.slice(0, 200)}...`
                                                    : paper.abstract}
                                        </span>
                                        {paper.abstract.length > 200 && (
                                            <span
                                                className={styles.resultAbstractToggle}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleAbstract(paper.id);
                                                }}
                                            >
                                                {expandedAbstracts.has(paper.id) ? '▲ Thu gọn' : '▼ Xem abstract'}
                                            </span>
                                        )}
                                    </Flexbox>
                                )}
                                <Flexbox align={'center'} gap={8} horizontal wrap={'wrap'}>
                                    <Tag
                                        color={
                                            paper.source === 'PubMed' ? 'blue'
                                                : paper.source === 'ArXiv' ? 'purple'
                                                    : paper.source === 'ClinicalTrials.gov' ? 'cyan'
                                                        : 'green'
                                        }
                                        style={{ fontSize: 11 }}
                                    >
                                        {paper.source}
                                    </Tag>
                                    {paper.isOpenAccess && <span className={styles.openAccess}>Open Access</span>}
                                    {paper.journal && (
                                        <span className={styles.resultMeta}>{paper.journal}</span>
                                    )}
                                    {paper.year > 0 && (
                                        <span className={styles.resultMeta}>· {paper.year}</span>
                                    )}
                                    {paper.citations !== undefined && paper.citations > 0 && (
                                        <span className={styles.resultMeta}>
                                            📝 {paper.citations.toLocaleString()} citations
                                        </span>
                                    )}
                                </Flexbox>
                            </Flexbox>
                        </div>
                    ))}
                    {/* Load More */}
                    {hasMore && (
                        <Flexbox align={'center'} justify={'center'} style={{ paddingTop: 4 }}>
                            <Button
                                loading={isLoadingMore}
                                onClick={loadMoreResults}
                                size={'small'}
                            >
                                {isLoadingMore ? 'Đang tải thêm...' : `⬇ Tải thêm papers`}
                            </Button>
                        </Flexbox>
                    )}
                    {/* Proceed to Screening */}
                    <Flexbox align={'center'} justify={'center'} style={{ paddingTop: 8 }}>
                        <Button
                            icon={<ArrowRight size={14} />}
                            onClick={() => setActivePhase('screening')}
                            type={'primary'}
                        >
                            Proceed to Screening ({totalResults} papers)
                        </Button>
                    </Flexbox>
                </Flexbox>
            )}

            {/* Empty state — only when user has not searched yet (noPapersFound has its own gate above) */}
            {papers.length === 0 && !isSearching && !searchError && !noPapersFound && (
                <>
                    <div className={styles.emptyState}>
                        <span style={{ fontSize: 48 }}>🔬</span>
                        <span style={{ fontSize: 16, fontWeight: 600 }}>Research Mode</span>
                        <span style={{ fontSize: 13 }}>
                            Nhập câu hỏi nghiên cứu để AI phân tích PICO
                            <br />
                            và tìm kiếm papers từ PubMed, OpenAlex
                        </span>
                    </div>
                    {/* PDF Upload — alternative entry point */}
                    <PdfUploader />
                </>
            )}
        </Flexbox>
    );
});

DiscoveryPhase.displayName = 'DiscoveryPhase';

export default DiscoveryPhase;
