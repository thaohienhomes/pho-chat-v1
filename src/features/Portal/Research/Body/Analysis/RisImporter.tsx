'use client';

/**
 * RIS / BibTeX Importer
 *
 * Parses reference files from Zotero, Mendeley, EndNote, PubMed:
 *   - RIS format (.ris) — tagged pairs TY/TI/AU/AB/PY/DO/JO/VL/SP/EP
 *   - BibTeX format (.bib) — @article{key, title={}, author={}, ...}
 *   - PubMed NBIB format (.nbib / .txt)
 *
 * Outputs parsed papers → adds to research store via addPapers()
 * Shows import summary: total / parsed / skipped (missing title)
 */
import { Button, Tag } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { AlertCircle, CheckCircle, FileText, Upload, X } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Flexbox } from 'react-layout-kit';

import { type PaperResult, useResearchStore } from '@/store/research';

// ── Styles ────────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  container: css`
    width: 100%;
  `,
  dropzone: css`
    cursor: pointer;

    padding-block: 36px;
    padding-inline: 24px;
    border: 2px dashed ${token.colorBorder};
    border-radius: ${token.borderRadiusLG}px;

    text-align: center;

    transition:
      border-color 0.2s,
      background 0.2s;

    &:hover,
    &.active {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  paperRow: css`
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;

    padding-block: 6px;
    padding-inline: 0;
    border-block-end: 1px solid ${token.colorBorder};

    font-size: 11px;

    &:last-child {
      border-block-end: none;
    }
  `,
}));

// ── Types ─────────────────────────────────────────────────────────────────────
interface ParsedRef {
  abstract?: string;
  authors: string[];
  doi?: string;
  journal?: string;
  pmid?: string;
  title: string;
  year?: number;
}

interface ImportResult {
  duplicates: number;
  imported: number;
  parsed: ParsedRef[];
  skipped: number;
  total: number;
}

// ── RIS Parser ────────────────────────────────────────────────────────────────
const parseRIS = (text: string): ParsedRef[] => {
  const records: ParsedRef[] = [];
  let current: Partial<ParsedRef> & { authors: string[] } = { authors: [] };
  let inRecord = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const tag = line.slice(0, 2);
    const value = line.slice(6).trim(); // RIS: "TY  - ..."

    if (tag === 'TY') {
      inRecord = true;
      current = { authors: [] };
      continue;
    }
    if (tag === 'ER') {
      if (inRecord && current.title) records.push(current as ParsedRef);
      inRecord = false;
      current = { authors: [] };
      continue;
    }
    if (!inRecord) continue;

    switch (tag) {
      case 'TI':
      case 'T1': {
        current.title = value;
        break;
      }
      case 'AU':
      case 'A1':
      case 'A2': {
        current.authors.push(value);
        break;
      }
      case 'AB':
      case 'N2': {
        current.abstract = value;
        break;
      }
      case 'PY':
      case 'Y1': {
        current.year = Number.parseInt(value.slice(0, 4), 10) || undefined;
        break;
      }
      case 'JO':
      case 'JF':
      case 'T2': {
        current.journal = value;
        break;
      }
      case 'DO': {
        current.doi = value;
        break;
      }
      case 'AN': {
        if (value.startsWith('PMID:')) current.pmid = value.replace('PMID:', '').trim();
        break;
      }
    }
  }
  return records;
};

// ── BibTeX Parser ─────────────────────────────────────────────────────────────
const parseBib = (text: string): ParsedRef[] => {
  const records: ParsedRef[] = [];
  const entryRegex = /@\w+{[^,]+,([^@]+)}/gs;
  const fieldRegex = /(\w+)\s*=\s*["{](.+?)["}]\s*[,}]/gs;

  for (const entryMatch of text.matchAll(entryRegex)) {
    const body = entryMatch[1];
    const fields: Record<string, string> = {};
    for (const fm of body.matchAll(fieldRegex)) {
      fields[fm[1].toLowerCase()] = fm[2].trim();
    }
    if (!fields['title']) continue;
    const authors = (fields['author'] ?? '')
      .split(' and ')
      .map((a) => a.trim())
      .filter(Boolean);
    records.push({
      abstract: fields['abstract'],
      authors,
      doi: fields['doi'],
      journal: fields['journal'] ?? fields['journaltitle'],
      title: fields['title'].replaceAll('{', '').replaceAll('}', ''),
      year: fields['year'] ? Number.parseInt(fields['year'], 10) : undefined,
    });
  }
  return records;
};

// ── NBIB (PubMed) Parser ──────────────────────────────────────────────────────
const parseNBIB = (text: string): ParsedRef[] => {
  const records: ParsedRef[] = [];
  let cur: Partial<ParsedRef> & { authors: string[] } = { authors: [] };
  let lastTag = '';

  for (const rawLine of text.split('\n')) {
    const tag = rawLine.slice(0, 4).trim();
    const value = rawLine.slice(6).trim();

    switch (tag) {
      case 'PMID': {
        if (cur.title) records.push(cur as ParsedRef);
        cur = { authors: [], pmid: value };
        break;
      }
      case 'TI': {
        cur.title = value;
        lastTag = 'TI';
        break;
      }
      case 'AB': {
        cur.abstract = value;
        lastTag = 'AB';
        break;
      }
      case 'AU': {
        cur.authors.push(value);
        lastTag = 'AU';
        break;
      }
      case 'DP': {
        cur.year = Number.parseInt(value.slice(0, 4), 10) || undefined;
        break;
      }
      case 'TA': {
        cur.journal = value;
        break;
      }
      default: {
        if (tag === 'LID' && value.includes('[doi]')) {
          cur.doi = value.replace('[doi]', '').trim();
        } else if (tag === '' && lastTag === 'TI') {
          cur.title = (cur.title ?? '') + ' ' + value;
        } else if (tag === '' && lastTag === 'AB') {
          cur.abstract = (cur.abstract ?? '') + ' ' + value;
        } else {
          lastTag = tag;
        }
      }
    }
  }
  if (cur.title) records.push(cur as ParsedRef);
  return records;
};

// ── Detect format ─────────────────────────────────────────────────────────────
const detectFormat = (text: string): 'bib' | 'nbib' | 'ris' | 'unknown' => {
  const trimmed = text.trim();
  if (trimmed.startsWith('@')) return 'bib';
  if (/^TY\s+-/.test(trimmed)) return 'ris';
  if (trimmed.startsWith('PMID-') || /^TI\s+-/.test(trimmed)) return 'nbib';
  return 'unknown';
};

const parseText = (text: string): ParsedRef[] => {
  const fmt = detectFormat(text);
  if (fmt === 'ris') return parseRIS(text);
  if (fmt === 'bib') return parseBib(text);
  if (fmt === 'nbib') return parseNBIB(text);
  // try all
  const ris = parseRIS(text);
  if (ris.length > 0) return ris;
  return parseBib(text);
};

// ── Converter → PaperResult ───────────────────────────────────────────────────
const toPaperResult = (ref: ParsedRef, idx: number): PaperResult => ({
  abstract: ref.abstract ?? '',
  authors: ref.authors.join(', '),
  doi: ref.doi,
  id: `imported-${Date.now()}-${idx}`,
  journal: ref.journal,
  source: 'PubMed',
  title: ref.title,
  year: ref.year ?? 0,
});

// ── Component ─────────────────────────────────────────────────────────────────
const RisImporter = memo(() => {
  const { styles } = useStyles();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<ParsedRef[]>([]);
  const [imported, setImported] = useState(false);

  const addPapers = useResearchStore((s) => s.addPapers);
  const papers = useResearchStore((s) => s.papers);

  const processText = useCallback((raw: string) => {
    setText(raw);
    const parsed = parseText(raw);
    setPreview(parsed.slice(0, 5));
    setResult({
      duplicates: 0,
      imported: 0,
      parsed,
      skipped: 0,
      total: parsed.length,
    });
    setImported(false);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const raw = await file.text();
      processText(raw);
    },
    [processText],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const doImport = useCallback(() => {
    if (!result) return;
    const existingIds = new Set(papers.map((p) => p.doi ?? p.title));
    let dupes = 0,
      skipped = 0;
    const toAdd: PaperResult[] = [];
    for (const [i, ref] of result.parsed.entries()) {
      if (!ref.title) {
        skipped++;
        continue;
      }
      const key = ref.doi ?? ref.title;
      if (existingIds.has(key)) {
        dupes++;
        continue;
      }
      toAdd.push(toPaperResult(ref, i));
    }
    if (toAdd.length > 0) addPapers(toAdd);
    setResult((prev) =>
      prev ? { ...prev, duplicates: dupes, imported: toAdd.length, skipped } : null,
    );
    setImported(true);
  }, [result, papers, addPapers]);

  const reset = useCallback(() => {
    setText('');
    setResult(null);
    setPreview([]);
    setImported(false);
  }, []);

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox gap={2}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>
          📎 Reference Importer (RIS / BibTeX / NBIB)
        </span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          Import from Zotero, Mendeley, EndNote, PubMed — drag &amp; drop or paste directly
        </span>
      </Flexbox>

      {/* Drop zone */}
      {!text && (
        <div
          className={`${styles.dropzone}${dragging ? ' active' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragLeave={() => setDragging(false)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDrop={handleDrop}
        >
          <Upload size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
          <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>
            Drop .ris / .bib / .nbib file here
          </p>
          <p style={{ fontSize: 11, margin: 0, opacity: 0.5 }}>
            or click to browse · also supports plain paste below
          </p>
          <input
            accept=".ris,.bib,.nbib,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
            ref={fileRef}
            style={{ display: 'none' }}
            type="file"
          />
        </div>
      )}

      {/* Text paste area */}
      {!text && (
        <Flexbox gap={4}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Or paste reference text:</span>
          <textarea
            onChange={(e) => {
              if (e.target.value.trim()) processText(e.target.value);
            }}
            placeholder={
              'Paste RIS, BibTeX, or PubMed NBIB content here...\n\nExample RIS:\nTY  - JOUR\nTI  - Effect of aspirin...\nAU  - Smith, J\nPY  - 2023\nER  -'
            }
            rows={6}
            style={{
              background: 'rgba(0,0,0,0.1)',
              border: '1px solid rgba(128,128,128,0.3)',
              borderRadius: 6,
              color: 'inherit',
              fontFamily: 'monospace',
              fontSize: 11,
              padding: 10,
              resize: 'vertical',
              width: '100%',
            }}
          />
        </Flexbox>
      )}

      {/* Result summary */}
      {result && (
        <div className={styles.card}>
          <Flexbox gap={10}>
            <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
              <Flexbox gap={4} horizontal wrap={'wrap'}>
                <Tag color="blue">📄 {result.total} references parsed</Tag>
                <Tag color="green">✓ {result.parsed.length} valid</Tag>
                {result.skipped > 0 && (
                  <Tag color="orange">⚠ {result.skipped} skipped (no title)</Tag>
                )}
                {imported && (
                  <>
                    <Tag color="green">✅ {result.imported} imported</Tag>
                    {result.duplicates > 0 && <Tag>{result.duplicates} duplicates skipped</Tag>}
                  </>
                )}
                <Tag style={{ fontSize: 10 }}>{detectFormat(text).toUpperCase()} format</Tag>
              </Flexbox>
              <button
                onClick={reset}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  opacity: 0.5,
                }}
                type="button"
              >
                <X size={14} />
              </button>
            </Flexbox>

            {/* Preview */}
            {preview.length > 0 && (
              <Flexbox gap={2}>
                <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.6 }}>
                  Preview (first {preview.length}):
                </span>
                {preview.map((ref, i) => (
                  <div className={styles.paperRow} key={i}>
                    <Flexbox gap={1}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{ref.title}</span>
                      <span style={{ fontSize: 10, opacity: 0.5 }}>
                        {ref.authors.slice(0, 2).join(', ')}
                        {ref.authors.length > 2 ? ' et al.' : ''} · {ref.year} · {ref.journal}
                      </span>
                    </Flexbox>
                    <Flexbox gap={4} horizontal>
                      {ref.doi && <Tag style={{ fontSize: 9 }}>DOI</Tag>}
                      {ref.pmid && <Tag style={{ fontSize: 9 }}>PMID</Tag>}
                    </Flexbox>
                  </div>
                ))}
                {result.total > 5 && (
                  <span style={{ fontSize: 10, opacity: 0.4 }}>
                    … and {result.total - 5} more references
                  </span>
                )}
              </Flexbox>
            )}

            {/* Action */}
            {!imported ? (
              <Button icon={<CheckCircle size={13} />} onClick={doImport} type={'primary'}>
                Import {result.total} References to Research Mode
              </Button>
            ) : (
              <Flexbox align={'center'} gap={8} horizontal>
                <CheckCircle size={16} style={{ color: '#52c41a' }} />
                <span style={{ color: '#52c41a', fontSize: 13, fontWeight: 600 }}>
                  ✅ {result.imported} papers added! Go to Discovery tab to see them.
                </span>
              </Flexbox>
            )}
          </Flexbox>
        </div>
      )}

      {/* Instructions */}
      {!result && (
        <div className={styles.card}>
          <Flexbox gap={8}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>
              📋 How to export from your reference manager:
            </span>
            <Flexbox gap={6}>
              {[
                { fmt: 'Zotero', steps: 'Select all → File → Export Library → RIS format' },
                { fmt: 'Mendeley', steps: 'File → Export → RIS or BibTeX' },
                { fmt: 'EndNote', steps: 'File → Export → choose BibTeX or RIS' },
                {
                  fmt: 'PubMed',
                  steps: 'Send to → Citation manager → Format: PubMed → Create file (.nbib)',
                },
              ].map(({ fmt, steps }) => (
                <Flexbox align={'flex-start'} gap={6} horizontal key={fmt}>
                  <FileText size={11} style={{ flexShrink: 0, marginTop: 2, opacity: 0.5 }} />
                  <span style={{ fontSize: 11 }}>
                    <strong>{fmt}:</strong> {steps}
                  </span>
                </Flexbox>
              ))}
            </Flexbox>
            <Flexbox align={'flex-start'} gap={6} horizontal>
              <AlertCircle size={11} style={{ color: '#faad14', flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 10, opacity: 0.6 }}>
                After import, use the <strong>Deduplication</strong> tab to remove duplicate entries
                across databases.
              </span>
            </Flexbox>
          </Flexbox>
        </div>
      )}
    </Flexbox>
  );
});

RisImporter.displayName = 'RisImporter';
export default RisImporter;
