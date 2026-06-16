'use client';

/**
 * Deduplication Engine
 *
 * Detects and removes duplicate papers across databases using:
 *   1. Exact DOI match
 *   2. Exact PMID match
 *   3. Levenshtein-based fuzzy title similarity (threshold 0.85)
 *   4. Author + Year fingerprint (if no DOI/PMID)
 *
 * Groups duplicates → user chooses which to keep (primary citation).
 * Shows confidence score and match reason for each group.
 */
import { Button, Tag } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { CheckCircle, Copy, Merge, RefreshCw, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { type PaperResult, useResearchStore } from '@/store/research';

// ── Styles ────────────────────────────────────────────────────────────────────
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
  dupGroup: css`
    padding-block: 12px;
    padding-inline: 14px;
    border: 2px solid ${token.colorWarningBorder};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorWarningBg};
  `,
  paperRow: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;

    background: ${token.colorBgContainer};

    transition: border-color 0.15s;

    &.selected {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }

    &:hover {
      border-color: ${token.colorPrimary};
    }
  `,
  statsBar: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: ${token.borderRadiusLG}px;

    background: linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorFillQuaternary});
  `,
}));

// ── Types ─────────────────────────────────────────────────────────────────────
interface DupGroup {
  confidence: number;
  ids: string[];
  keepId: string;
  reason: string;
}

// ── Levenshtein similarity ─────────────────────────────────────────────────────
const levenshtein = (a: string, b: string): number => {
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

const normalizeTitle = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^\s\w]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();

const confidenceColor = (c: number) => (c === 100 ? '#52c41a' : c >= 90 ? '#1890ff' : '#faad14');

const titleSimilarity = (a: string, b: string): number => {
  const na = normalizeTitle(a),
    nb = normalizeTitle(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
};

// ── Dedup algorithm ───────────────────────────────────────────────────────────
const findDuplicates = (papers: PaperResult[]): DupGroup[] => {
  const groups: DupGroup[] = [];
  const grouped = new Set<string>();

  for (let i = 0; i < papers.length; i++) {
    if (grouped.has(papers[i].id)) continue;
    const groupIds: string[] = [papers[i].id];
    let reason = '';
    let confidence = 0;

    for (let j = i + 1; j < papers.length; j++) {
      if (grouped.has(papers[j].id)) continue;
      const a = papers[i],
        b = papers[j];

      // 1. Exact DOI
      if (a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase()) {
        groupIds.push(b.id);
        reason = 'Exact DOI match';
        confidence = 100;
        continue;
      }
      // 2. Exact PMID
      if (a.pmid && b.pmid && a.pmid === b.pmid) {
        groupIds.push(b.id);
        reason = 'Exact PMID match';
        confidence = 100;
        continue;
      }
      // 3. Fuzzy title
      if (a.title && b.title) {
        const sim = titleSimilarity(a.title, b.title);
        if (sim >= 0.85) {
          // Bonus: same year or same first author
          let bonus = 0;
          if (a.year && b.year && a.year === b.year) bonus += 0.05;
          if (
            a.authors.split(',')[0] &&
            b.authors.split(',')[0] &&
            titleSimilarity(a.authors.split(',')[0], b.authors.split(',')[0]) > 0.7
          )
            bonus += 0.05;
          const totalSim = Math.min(1, sim + bonus);
          if (totalSim >= 0.85) {
            groupIds.push(b.id);
            reason = `Title similarity ${Math.round(totalSim * 100)}%`;
            confidence = Math.round(totalSim * 100);
            continue;
          }
        }
      }
      // 4. Author + year + journal fingerprint
      if (
        a.year &&
        b.year &&
        a.year === b.year &&
        a.journal &&
        b.journal &&
        a.authors.split(',')[0] &&
        b.authors.split(',')[0]
      ) {
        const authSim = titleSimilarity(a.authors.split(',')[0], b.authors.split(',')[0]);
        const journSim = titleSimilarity(a.journal, b.journal);
        if (authSim > 0.85 && journSim > 0.8) {
          groupIds.push(b.id);
          reason = `Same author + year + journal (${Math.round(Math.min(authSim, journSim) * 100)}%)`;
          confidence = Math.round(Math.min(authSim, journSim) * 100);
        }
      }
    }

    if (groupIds.length > 1) {
      for (const id of groupIds) grouped.add(id);
      // prefer paper with DOI or most metadata
      const groupPapers = groupIds.map((id) => papers.find((p) => p.id === id)!);
      const best = groupPapers.sort((a, b) => {
        let sa = 0,
          sb = 0;
        if (a.doi) sa += 3;
        if (b.doi) sb += 3;
        if (a.pmid) sa += 2;
        if (b.pmid) sb += 2;
        if (a.abstract) sa += 1;
        if (b.abstract) sb += 1;
        return sb - sa;
      })[0];
      groups.push({ confidence, ids: groupIds, keepId: best.id, reason });
    }
  }
  return groups;
};

// ── Component ─────────────────────────────────────────────────────────────────
const DeduplicationEngine = memo(() => {
  const { styles } = useStyles();
  const papers = useResearchStore((s) => s.papers);
  const removePapers = useResearchStore((s) => s.removePapers);

  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [keepMap, setKeepMap] = useState<Record<number, string>>({});
  const [done, setDone] = useState(false);
  const [removed, setRemoved] = useState(0);

  const runDedup = useCallback(() => {
    const found = findDuplicates(papers);
    setGroups(found);
    const init: Record<number, string> = {};
    for (const [i, g] of found.entries()) init[i] = g.keepId;
    setKeepMap(init);
    setDone(false);
    setRemoved(0);
  }, [papers]);

  const totalDupes = useMemo(
    () => groups?.reduce((s, g) => s + g.ids.length - 1, 0) ?? 0,
    [groups],
  );

  const applyDedup = useCallback(() => {
    if (!groups) return;
    const toRemove: string[] = [];
    for (const [i, g] of groups.entries()) {
      const keep = keepMap[i] ?? g.keepId;
      for (const id of g.ids) {
        if (id !== keep) toRemove.push(id);
      }
    }
    removePapers(toRemove);
    setRemoved(toRemove.length);
    setDone(true);
  }, [groups, keepMap, removePapers]);

  const setKeep = useCallback((groupIdx: number, paperId: string) => {
    setKeepMap((prev) => ({ ...prev, [groupIdx]: paperId }));
  }, []);

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox gap={2}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>♻️ Deduplication Engine</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          Finds duplicate records across databases using DOI, PMID, and fuzzy title matching
        </span>
      </Flexbox>

      {/* Stats bar */}
      <div className={styles.statsBar}>
        <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
          <Flexbox gap={4} horizontal wrap={'wrap'}>
            <Tag color="blue">📄 {papers.length} total papers</Tag>
            {groups !== null && (
              <>
                <Tag color={totalDupes > 0 ? 'orange' : 'green'}>
                  {totalDupes > 0
                    ? `⚠️ ${groups.length} duplicate groups (${totalDupes} extra copies)`
                    : '✅ No duplicates found'}
                </Tag>
                {done && <Tag color="green">🗑️ {removed} removed</Tag>}
              </>
            )}
          </Flexbox>
          <Flexbox gap={8} horizontal>
            <Button
              icon={groups === null ? <Copy size={13} /> : <RefreshCw size={13} />}
              onClick={runDedup}
            >
              {groups === null ? 'Find Duplicates' : 'Re-scan'}
            </Button>
            {groups && totalDupes > 0 && !done && (
              <Button icon={<Merge size={13} />} onClick={applyDedup} type={'primary'}>
                Remove {totalDupes} Duplicates
              </Button>
            )}
          </Flexbox>
        </Flexbox>
      </div>

      {/* Duplicate groups */}
      {groups !== null && groups.length === 0 && (
        <div style={{ opacity: 0.5, padding: 32, textAlign: 'center' }}>
          <CheckCircle
            size={32}
            style={{ color: '#52c41a', display: 'block', margin: '0 auto 12px' }}
          />
          <span style={{ fontSize: 13 }}>
            No duplicates detected in your {papers.length} papers 🎉
          </span>
        </div>
      )}

      {done && groups && groups.length > 0 && (
        <div
          style={{
            background: 'rgba(82,196,26,0.06)',
            border: '1px solid #b7eb8f',
            borderRadius: 8,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <CheckCircle size={24} style={{ color: '#52c41a', marginBottom: 8 }} />
          <p style={{ color: '#52c41a', fontSize: 13, fontWeight: 600, margin: 0 }}>
            ✅ Removed {removed} duplicate records. {papers.length} unique papers remain.
          </p>
        </div>
      )}

      {!done &&
        groups?.map((group, gi) => {
          const groupPapers = group.ids
            .map((id) => papers.find((p) => p.id === id))
            .filter(Boolean) as PaperResult[];
          const selected = keepMap[gi] ?? group.keepId;
          return (
            <div className={styles.dupGroup} key={gi}>
              <Flexbox gap={8}>
                {/* Group header */}
                <Flexbox align={'center'} gap={8} horizontal>
                  <Copy size={13} style={{ color: '#faad14' }} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>Duplicate Group #{gi + 1}</span>
                  <Tag color="orange">{group.ids.length} copies</Tag>
                  <Tag
                    style={{
                      borderColor: confidenceColor(group.confidence),
                      color: confidenceColor(group.confidence),
                      fontSize: 10,
                    }}
                  >
                    {group.confidence}% confidence · {group.reason}
                  </Tag>
                  <span style={{ fontSize: 10, marginLeft: 'auto', opacity: 0.5 }}>
                    Click to select which to keep ↓
                  </span>
                </Flexbox>

                {/* Papers in group */}
                {groupPapers.map((p) => {
                  const isSelected = selected === p.id;
                  return (
                    <div
                      className={`${styles.paperRow}${isSelected ? ' selected' : ''}`}
                      key={p.id}
                      onClick={() => setKeep(gi, p.id)}
                    >
                      <Flexbox gap={4}>
                        <Flexbox align={'center'} gap={6} horizontal>
                          <div
                            style={{
                              background: isSelected ? '#52c41a' : 'transparent',
                              border: `2px solid ${isSelected ? '#52c41a' : 'rgba(128,128,128,0.4)'}`,
                              borderRadius: '50%',
                              flexShrink: 0,
                              height: 14,
                              width: 14,
                            }}
                          />
                          <span
                            style={{
                              flexShrink: 1,
                              fontSize: 12,
                              fontWeight: isSelected ? 700 : 400,
                            }}
                          >
                            {p.title}
                          </span>
                          {isSelected && (
                            <Tag color="green" style={{ flexShrink: 0, fontSize: 9 }}>
                              KEEP
                            </Tag>
                          )}
                        </Flexbox>
                        <Flexbox gap={6} horizontal style={{ paddingLeft: 20 }} wrap={'wrap'}>
                          <span style={{ fontSize: 10, opacity: 0.6 }}>
                            {p.authors.split(',').slice(0, 2).join(', ')}
                            {p.authors.split(',').length > 2 ? ' et al.' : ''}
                          </span>
                          {p.year && <span style={{ fontSize: 10, opacity: 0.6 }}>· {p.year}</span>}
                          {p.journal && (
                            <span style={{ fontSize: 10, opacity: 0.6 }}>· {p.journal}</span>
                          )}
                          {p.doi && <Tag style={{ fontSize: 9 }}>DOI ✓</Tag>}
                          {p.pmid && <Tag style={{ fontSize: 9 }}>PMID ✓</Tag>}
                          {p.abstract && <Tag style={{ fontSize: 9 }}>Abstract ✓</Tag>}
                          {p.source && <Tag style={{ fontSize: 9 }}>{p.source}</Tag>}
                        </Flexbox>
                      </Flexbox>
                    </div>
                  );
                })}

                {/* Group action */}
                <Flexbox align={'center'} gap={6} horizontal>
                  <Trash2 size={10} style={{ opacity: 0.4 }} />
                  <span style={{ fontSize: 10, opacity: 0.5 }}>
                    {group.ids.length - 1} record{group.ids.length > 2 ? 's' : ''} will be removed
                    when you apply
                  </span>
                </Flexbox>
              </Flexbox>
            </div>
          );
        })}

      {/* Algorithm info */}
      {groups === null && (
        <div className={styles.card}>
          <Flexbox gap={6}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>🔍 Detection methods:</span>
            {[
              { icon: '🎯', label: 'Exact DOI match', pct: '100%' },
              { icon: '🏥', label: 'Exact PMID match', pct: '100%' },
              { icon: '🔤', label: 'Fuzzy title similarity (Levenshtein)', pct: '≥85%' },
              { icon: '👤', label: 'Author + Year + Journal fingerprint', pct: '≥85%' },
            ].map(({ icon, label, pct }) => (
              <Flexbox align={'center'} gap={8} horizontal key={label}>
                <span style={{ fontSize: 12 }}>{icon}</span>
                <span style={{ fontSize: 11 }}>{label}</span>
                <Tag style={{ fontSize: 9, marginLeft: 'auto' }}>confidence {pct}</Tag>
              </Flexbox>
            ))}
          </Flexbox>
        </div>
      )}
    </Flexbox>
  );
});

DeduplicationEngine.displayName = 'DeduplicationEngine';
export default DeduplicationEngine;
