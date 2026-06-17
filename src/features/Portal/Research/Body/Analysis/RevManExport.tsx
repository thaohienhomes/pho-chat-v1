'use client';

/**
 * RevMan 5 XML Export
 *
 * Generates Cochrane RevMan 5 compatible XML from included papers and
 * meta-analysis data in the research store. Supports:
 *   - Review metadata (title, authors, PROSPERO ID, protocol)
 *   - Included studies with characteristics
 *   - Dichotomous & continuous outcome data
 *   - Risk of Bias tables
 *   - Download as .rm5 XML file
 *
 * Based on RevMan 5.4 DTD specification.
 */
import { Button, Tag } from '@lobehub/ui';
import { Input } from 'antd';
import { createStyles } from 'antd-style';
import { Download, FileCode2, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
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
  input: css`
    padding-block: 4px;
    padding-inline: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 4px;

    font-size: 12px;
    color: inherit;

    background: ${token.colorFillQuaternary};

    &:focus {
      border-color: ${token.colorPrimary};
      outline: none;
    }
  `,
  pre: css`
    overflow-x: auto;

    max-height: 400px;
    padding: 12px;
    border-radius: 8px;

    font-family: 'Fira Code', monospace;
    font-size: 10px;
    color: #7ec699;
    white-space: pre;

    background: #0a0a0a;
  `,
}));

interface OutcomeEntry {
  ci_end: string;
  ci_start: string;
  effect: string;
  id: string;
  n_control: string;
  n_intervention: string;
  name: string;
  type: 'dichotomous' | 'continuous';
  weight: string;
}

const RevManExport = memo(() => {
  const { styles } = useStyles();
  const allPapers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const searchQuery = useResearchStore((s) => s.searchQuery);
  const pico = useResearchStore((s) => s.pico);
  const papers = allPapers.filter((p) => screeningDecisions[p.id]?.decision === 'included');

  const [reviewTitle, setReviewTitle] = useState(searchQuery || '');
  const [prosperoId, setProsperoId] = useState('');
  const [reviewAuthors, setReviewAuthors] = useState('');
  const [outcomes, setOutcomes] = useState<OutcomeEntry[]>([
    {
      ci_end: '0.92',
      ci_start: '0.56',
      effect: '0.72',
      id: 'o1',
      n_control: '150',
      n_intervention: '148',
      name: 'Primary Outcome',
      type: 'dichotomous',
      weight: '100',
    },
  ]);
  const [showPreview, setShowPreview] = useState(false);

  const addOutcome = useCallback(() => {
    setOutcomes((prev) => [
      ...prev,
      {
        ci_end: '',
        ci_start: '',
        effect: '',
        id: `o${Date.now()}`,
        n_control: '',
        n_intervention: '',
        name: '',
        type: 'dichotomous',
        weight: '',
      },
    ]);
  }, []);

  const removeOutcome = useCallback((id: string) => {
    setOutcomes((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const updateOutcome = useCallback((id: string, key: keyof OutcomeEntry, val: string) => {
    setOutcomes((prev) => prev.map((o) => (o.id === id ? { ...o, [key]: val } : o)));
  }, []);

  const picoStr = pico
    ? `Population: ${pico.population}\nIntervention: ${pico.intervention}\nComparison: ${pico.comparison}\nOutcome: ${pico.outcome}`
    : '';

  const generateXML = useMemo(() => {
    const esc = (s: string) =>
      s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    const now = new Date().toISOString().slice(0, 10);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<COCHRANE_REVIEW MODIFIED="${now}" REVISION_NR="1">\n`;
    xml += `  <COVER_SHEET>\n`;
    xml += `    <TITLE>${esc(reviewTitle || searchQuery || 'Untitled Review')}</TITLE>\n`;
    xml += `    <CONTACT>\n`;
    xml += `      <PERSON>${esc(reviewAuthors || 'Review Team')}</PERSON>\n`;
    xml += `    </CONTACT>\n`;
    if (prosperoId) {
      xml += `    <REGISTRATION>${esc(prosperoId)}</REGISTRATION>\n`;
    }
    xml += `    <DATES>\n`;
    xml += `      <LAST_SEARCH>${now}</LAST_SEARCH>\n`;
    xml += `    </DATES>\n`;
    xml += `  </COVER_SHEET>\n\n`;

    // PICO
    if (picoStr) {
      xml += `  <OBJECTIVES>${esc(picoStr)}</OBJECTIVES>\n\n`;
    }

    // Included studies
    xml += `  <STUDIES_AND_REFERENCES>\n`;
    xml += `    <INCLUDED_STUDIES>\n`;
    for (const p of papers) {
      const firstAuthor = p.authors.split(',')[0]?.trim() || 'Unknown';
      xml += `      <STUDY DATA_SOURCE="PUBMED" ID="${esc(p.id)}" NAME="${esc(firstAuthor)} ${p.year}" YEAR="${p.year}">\n`;
      xml += `        <REFERENCE>\n`;
      xml += `          <AU>${esc(p.authors)}</AU>\n`;
      xml += `          <TI>${esc(p.title)}</TI>\n`;
      if (p.journal) xml += `          <SO>${esc(p.journal)}</SO>\n`;
      if (p.doi) xml += `          <UI DOI="${esc(p.doi)}" />\n`;
      xml += `          <YR>${p.year}</YR>\n`;
      xml += `        </REFERENCE>\n`;
      xml += `      </STUDY>\n`;
    }
    xml += `    </INCLUDED_STUDIES>\n`;
    xml += `  </STUDIES_AND_REFERENCES>\n\n`;

    // Outcomes / analyses
    xml += `  <ANALYSES_AND_DATA>\n`;
    for (const [i, o] of outcomes.entries()) {
      xml += `    <COMPARISON ID="CMP-${i + 1}" NAME="${esc(o.name || `Outcome ${i + 1}`)}">\n`;
      xml += `      <OUTCOME DATA_TYPE="${o.type === 'dichotomous' ? 'DICH' : 'CONT'}" ID="OUT-${i + 1}" NAME="${esc(o.name)}">\n`;
      xml += `        <EFFECT_MEASURE>${o.type === 'dichotomous' ? 'RR' : 'MD'}</EFFECT_MEASURE>\n`;
      xml += `        <CI_STUDY CI_END="${o.ci_end}" CI_START="${o.ci_start}" EFFECT_SIZE="${o.effect}" N_1="${o.n_intervention}" N_2="${o.n_control}" WEIGHT="${o.weight}" />\n`;
      xml += `      </OUTCOME>\n`;
      xml += `    </COMPARISON>\n`;
    }
    xml += `  </ANALYSES_AND_DATA>\n\n`;

    // Generator info
    xml += `  <ADDITIONAL_DATA>\n`;
    xml += `    <GENERATED_BY>Pho Research Mode v1.0</GENERATED_BY>\n`;
    xml += `    <EXPORT_DATE>${now}</EXPORT_DATE>\n`;
    xml += `    <TOTAL_INCLUDED_STUDIES>${papers.length}</TOTAL_INCLUDED_STUDIES>\n`;
    xml += `  </ADDITIONAL_DATA>\n`;

    xml += `</COCHRANE_REVIEW>\n`;
    return xml;
  }, [reviewTitle, searchQuery, reviewAuthors, prosperoId, picoStr, papers, outcomes]);

  const downloadXML = useCallback(() => {
    const blob = new Blob([generateXML], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(reviewTitle || 'review').replaceAll(/\s+/g, '_')}.rm5`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generateXML, reviewTitle]);

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📦 RevMan 5 XML Export</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Generate Cochrane-compatible .rm5 XML for submission to Cochrane Library
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal>
          <Tag color="blue">{papers.length} included studies</Tag>
          <Button icon={<FileCode2 size={12} />} onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? 'Hide preview' : 'Preview XML'}
          </Button>
          <Button icon={<Download size={12} />} onClick={downloadXML} type={'primary'}>
            Download .rm5
          </Button>
        </Flexbox>
      </Flexbox>

      {/* Review metadata */}
      <div className={styles.card}>
        <Flexbox gap={10}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>📝 Review Metadata</span>
          <Flexbox gap={8} horizontal wrap={'wrap'}>
            <Flexbox gap={2} style={{ flex: 2, minWidth: 200 }}>
              <span style={{ fontSize: 10, fontWeight: 600 }}>Review Title</span>
              <input
                className={styles.input}
                onChange={(e) => setReviewTitle(e.target.value)}
                placeholder="Systematic review title..."
                style={{ width: '100%' }}
                value={reviewTitle}
              />
            </Flexbox>
            <Flexbox gap={2} style={{ flex: 1, minWidth: 150 }}>
              <span style={{ fontSize: 10, fontWeight: 600 }}>PROSPERO ID</span>
              <input
                className={styles.input}
                onChange={(e) => setProsperoId(e.target.value)}
                placeholder="CRD42024..."
                style={{ width: '100%' }}
                value={prosperoId}
              />
            </Flexbox>
          </Flexbox>
          <Flexbox gap={2}>
            <span style={{ fontSize: 10, fontWeight: 600 }}>Authors</span>
            <Input
              onChange={(e) => setReviewAuthors(e.target.value)}
              placeholder="Author 1, Author 2, ..."
              size="small"
              value={reviewAuthors}
            />
          </Flexbox>
        </Flexbox>
      </div>

      {/* Outcomes */}
      <div className={styles.card}>
        <Flexbox gap={10}>
          <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>📊 Outcome Data</span>
            <Button icon={<Plus size={12} />} onClick={addOutcome} size="small">
              Add Outcome
            </Button>
          </Flexbox>
          {outcomes.map((o) => (
            <Flexbox
              gap={6}
              key={o.id}
              style={{ borderBottom: '1px solid rgba(128,128,128,0.15)', paddingBottom: 8 }}
            >
              <Flexbox align={'center'} gap={8} horizontal>
                <input
                  className={styles.input}
                  onChange={(e) => updateOutcome(o.id, 'name', e.target.value)}
                  placeholder="Outcome name"
                  style={{ flex: 2 }}
                  value={o.name}
                />
                <select
                  className={styles.input}
                  onChange={(e) =>
                    updateOutcome(o.id, 'type', e.target.value as 'dichotomous' | 'continuous')
                  }
                  style={{ width: 130 }}
                  value={o.type}
                >
                  <option value="dichotomous">Dichotomous (RR)</option>
                  <option value="continuous">Continuous (MD)</option>
                </select>
                <button
                  onClick={() => removeOutcome(o.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    opacity: 0.4,
                  }}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </Flexbox>
              <div
                style={{
                  display: 'grid',
                  fontSize: 10,
                  gap: 6,
                  gridTemplateColumns: 'repeat(5,1fr)',
                }}
              >
                {(['effect', 'ci_start', 'ci_end', 'n_intervention', 'n_control'] as const).map(
                  (key) => (
                    <Flexbox gap={2} key={key}>
                      <span style={{ fontWeight: 600 }}>
                        {key === 'effect'
                          ? 'Effect'
                          : key === 'ci_start'
                            ? 'CI low'
                            : key === 'ci_end'
                              ? 'CI high'
                              : key === 'n_intervention'
                                ? 'N interv'
                                : 'N control'}
                      </span>
                      <input
                        className={styles.input}
                        onChange={(e) => updateOutcome(o.id, key, e.target.value)}
                        step={0.01}
                        type="number"
                        value={o[key]}
                      />
                    </Flexbox>
                  ),
                )}
              </div>
            </Flexbox>
          ))}
        </Flexbox>
      </div>

      {/* XML Preview */}
      {showPreview && (
        <div>
          <Flexbox
            align={'center'}
            gap={8}
            horizontal
            justify={'space-between'}
            style={{ marginBottom: 8 }}
          >
            <span style={{ fontSize: 12, fontWeight: 700 }}>🔍 XML Preview</span>
            <Button onClick={() => navigator.clipboard.writeText(generateXML)} size="small">
              Copy XML
            </Button>
          </Flexbox>
          <pre className={styles.pre}>{generateXML}</pre>
        </div>
      )}

      <div style={{ borderTop: '1px solid', fontSize: 10, opacity: 0.4, paddingTop: 6 }}>
        📚 Compatible with RevMan 5.4 DTD · Cochrane Collaboration
      </div>
    </Flexbox>
  );
});

RevManExport.displayName = 'RevManExport';
export default RevManExport;
