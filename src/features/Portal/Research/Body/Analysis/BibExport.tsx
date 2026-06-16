'use client';

/**
 * BibTeX / RIS Export
 *
 * Exports included papers from the research store as BibTeX (.bib) or
 * RIS (.ris) files. Quick counterpart to the RIS Importer.
 *
 * Features:
 *   - Choose export format (BibTeX / RIS)
 *   - Choose study subset: all, included, excluded, pending
 *   - Preview formatted references
 *   - Download as file or copy to clipboard
 */
import { Button, Tag } from '@lobehub/ui';
import { Select } from 'antd';
import { createStyles } from 'antd-style';
import { Copy, Download, FileText } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { PaperResult, useResearchStore } from '@/store/research';

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
  pre: css`
    overflow-x: auto;

    max-height: 400px;
    padding: 12px;
    border-radius: 8px;

    font-family: 'Fira Code', monospace;
    font-size: 10px;
    color: #a3e635;
    white-space: pre;

    background: #0a0a0a;
  `,
}));

type Subset = 'all' | 'excluded' | 'included' | 'pending';
type Format = 'bibtex' | 'ris';

const generateCiteKey = (p: PaperResult) => {
  const author = (p.authors.split(',')[0]?.trim() || 'Unknown').replaceAll(/\s+/g, '');
  return `${author}${p.year}`;
};

const toBibTeX = (papers: PaperResult[]): string => {
  return papers
    .map((p) => {
      const key = generateCiteKey(p);
      const lines = [
        `@article{${key},`,
        `  author  = {${p.authors}},`,
        `  title   = {${p.title}},`,
        `  year    = {${p.year}},`,
        ...(p.journal ? [`  journal = {${p.journal}},`] : []),
        ...(p.doi ? [`  doi     = {${p.doi}},`] : []),
        ...(p.abstract ? [`  abstract = {${p.abstract.slice(0, 300)}},`] : []),
        '}',
      ];
      return lines.join('\n');
    })
    .join('\n\n');
};

const toRIS = (papers: PaperResult[]): string => {
  return papers
    .map((p) => {
      const authorLines = p.authors.split(',').map((a) => `AU  - ${a.trim()}`);
      const lines = [
        'TY  - JOUR',
        ...authorLines,
        `TI  - ${p.title}`,
        `PY  - ${p.year}`,
        ...(p.journal ? [`JO  - ${p.journal}`] : []),
        ...(p.doi ? [`DO  - ${p.doi}`] : []),
        ...(p.abstract ? [`AB  - ${p.abstract.slice(0, 500)}`] : []),
        ...(p.pubmedUrl ? [`UR  - ${p.pubmedUrl}`] : []),
        'ER  - ',
      ];
      return lines.join('\n');
    })
    .join('\n\n');
};

const BibExport = memo(() => {
  const { styles } = useStyles();
  const allPapers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);

  const [format, setFormat] = useState<Format>('bibtex');
  const [subset, setSubset] = useState<Subset>('included');
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const filteredPapers = useMemo(() => {
    if (subset === 'all') return allPapers;
    return allPapers.filter((p) => {
      const d = screeningDecisions[p.id]?.decision;
      if (subset === 'included') return d === 'included';
      if (subset === 'excluded') return d === 'excluded';
      return !d || d === 'pending';
    });
  }, [allPapers, screeningDecisions, subset]);

  const output = useMemo(() => {
    return format === 'bibtex' ? toBibTeX(filteredPapers) : toRIS(filteredPapers);
  }, [filteredPapers, format]);

  const download = useCallback(() => {
    const ext = format === 'bibtex' ? '.bib' : '.ris';
    const mime =
      format === 'bibtex' ? 'application/x-bibtex' : 'application/x-research-info-systems';
    const blob = new Blob([output], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research_export${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [output, format]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [output]);

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📤 BibTeX / RIS Export</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Export your references for Zotero, Mendeley, EndNote, LaTeX, or RevMan
          </span>
        </Flexbox>
        <Tag color="blue">{filteredPapers.length} references</Tag>
      </Flexbox>

      <Flexbox gap={10} horizontal wrap={'wrap'}>
        <Flexbox gap={2} style={{ minWidth: 150 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Format</span>
          <Select
            onChange={(v: Format) => setFormat(v)}
            options={[
              { label: '📚 BibTeX (.bib)', value: 'bibtex' },
              { label: '📄 RIS (.ris)', value: 'ris' },
            ]}
            style={{ width: '100%' }}
            value={format}
          />
        </Flexbox>
        <Flexbox gap={2} style={{ minWidth: 150 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Papers to export</span>
          <Select
            onChange={(v: Subset) => setSubset(v)}
            options={[
              {
                label: `✅ Included (${allPapers.filter((p) => screeningDecisions[p.id]?.decision === 'included').length})`,
                value: 'included',
              },
              {
                label: `❌ Excluded (${allPapers.filter((p) => screeningDecisions[p.id]?.decision === 'excluded').length})`,
                value: 'excluded',
              },
              { label: '⏳ Pending', value: 'pending' },
              { label: `📋 All (${allPapers.length})`, value: 'all' },
            ]}
            style={{ width: '100%' }}
            value={subset}
          />
        </Flexbox>
        <Flexbox gap={2} horizontal style={{ alignSelf: 'flex-end' }}>
          <Button icon={<Download size={12} />} onClick={download} type={'primary'}>
            Download .{format === 'bibtex' ? 'bib' : 'ris'}
          </Button>
          <Button icon={<Copy size={12} />} onClick={copy}>
            {copied ? '✓ Copied!' : 'Copy'}
          </Button>
          <Button icon={<FileText size={12} />} onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? 'Hide' : 'Preview'}
          </Button>
        </Flexbox>
      </Flexbox>

      {showPreview && filteredPapers.length > 0 && <pre className={styles.pre}>{output}</pre>}

      {filteredPapers.length === 0 && (
        <div className={styles.card} style={{ fontSize: 12, opacity: 0.5, textAlign: 'center' }}>
          No papers in this subset. Try selecting a different filter.
        </div>
      )}

      <div style={{ borderTop: '1px solid', fontSize: 10, opacity: 0.4, paddingTop: 6 }}>
        📚 Compatible with Zotero · Mendeley · EndNote · LaTeX · RevMan 5
      </div>
    </Flexbox>
  );
});

BibExport.displayName = 'BibExport';
export default BibExport;
