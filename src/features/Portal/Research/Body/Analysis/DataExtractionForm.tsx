'use client';

/**
 * Data Extraction Form Builder
 * Systematic review data extraction: define custom fields, fill per paper, export CSV.
 */
import { Button, Tag } from '@lobehub/ui';
import { Select } from 'antd';
import { createStyles } from 'antd-style';
import { Copy, Download, Plus, Trash2 } from 'lucide-react';
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
  field: css`
    width: 100%;
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
  tab: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 14px;
    border-block-end: 2px solid transparent;

    font-size: 12px;

    &.active {
      border-block-end-color: ${token.colorPrimary};
      font-weight: 700;
      color: ${token.colorPrimary};
    }
  `,
  tableCell: css`
    padding-block: 6px;
    padding-inline: 10px;
    border-block-end: 1px solid ${token.colorBorder};

    font-size: 11px;
    vertical-align: top;
  `,
  tableHeader: css`
    padding-block: 6px;
    padding-inline: 10px;

    font-size: 10px;
    font-weight: 700;
    text-align: start;

    background: ${token.colorFillSecondary};
  `,
}));

type FieldType = 'boolean' | 'date' | 'number' | 'select' | 'text';

interface FormField {
  id: string;
  label: string;
  options?: string[];
  required: boolean;
  type: FieldType;
}

type ExtractedData = Record<string, string>;

const DEFAULT_FIELDS: FormField[] = [
  {
    id: 'design',
    label: 'Study Design',
    options: ['RCT', 'Cohort', 'Case-control', 'Cross-sectional', 'Case series'],
    required: true,
    type: 'select',
  },
  { id: 'country', label: 'Country / Setting', required: false, type: 'text' },
  { id: 'n_total', label: 'Total N', required: true, type: 'number' },
  { id: 'n_intervention', label: 'N Intervention', required: false, type: 'number' },
  { id: 'n_control', label: 'N Control', required: false, type: 'number' },
  { id: 'mean_age', label: 'Mean Age (years)', required: false, type: 'number' },
  { id: 'followup', label: 'Follow-up Duration', required: false, type: 'text' },
  { id: 'primary_outcome', label: 'Primary Outcome', required: true, type: 'text' },
  { id: 'effect_size', label: 'Effect Size (RR/OR/MD)', required: false, type: 'text' },
  { id: 'p_value', label: 'p-value', required: false, type: 'number' },
  { id: 'industry_funded', label: 'Industry-funded?', required: false, type: 'boolean' },
  { id: 'notes', label: 'Extractor Notes', required: false, type: 'text' },
];

const FieldInput = ({
  field,
  onChange,
  value,
}: {
  field: FormField;
  onChange: (v: string) => void;
  value: string;
}) => {
  const { styles } = useStyles();
  if (field.type === 'boolean') {
    return (
      <Select
        onChange={(v: string) => onChange(v)}
        options={[
          { label: 'Yes', value: 'Yes' },
          { label: 'No', value: 'No' },
          { label: 'Unclear', value: 'Unclear' },
        ]}
        size="small"
        style={{ width: '100%' }}
        value={value || undefined}
      />
    );
  }
  if (field.type === 'select' && field.options) {
    return (
      <Select
        onChange={(v: string) => onChange(v)}
        options={field.options.map((o) => ({ label: o, value: o }))}
        size="small"
        style={{ width: '100%' }}
        value={value || undefined}
      />
    );
  }
  return (
    <input
      className={styles.field}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.label}
      type={field.type === 'number' ? 'number' : 'text'}
      value={value}
    />
  );
};

const DataExtractionForm = memo(() => {
  const { styles } = useStyles();
  const allPapers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const papers = allPapers.filter((p) => screeningDecisions[p.id]?.decision === 'included');
  const [fields, setFields] = useState<FormField[]>(DEFAULT_FIELDS);
  const [data, setData] = useState<Record<string, ExtractedData>>({});
  const [activeTab, setActiveTab] = useState<'extract' | 'fields' | 'table'>('extract');
  const [selectedPaper, setSelectedPaper] = useState<string>(papers[0]?.id ?? '');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [copied, setCopied] = useState(false);

  const setVal = useCallback((paperId: string, fieldId: string, val: string) => {
    setData((prev) => ({ ...prev, [paperId]: { ...prev[paperId], [fieldId]: val } }));
  }, []);

  const addField = useCallback(() => {
    if (!newFieldLabel.trim()) return;
    setFields((prev) => [
      ...prev,
      {
        id: newFieldLabel.toLowerCase().replaceAll(/\s+/g, '_'),
        label: newFieldLabel.trim(),
        required: false,
        type: newFieldType,
      },
    ]);
    setNewFieldLabel('');
  }, [newFieldLabel, newFieldType]);

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const filledCount = useMemo(
    () => papers.filter((p) => data[p.id] && Object.keys(data[p.id]).length > 0).length,
    [papers, data],
  );

  const exportCSV = useCallback(() => {
    const cols = ['Paper ID', 'Title', 'Authors', 'Year', ...fields.map((f) => f.label)];
    const rows = papers.map((p) => {
      const d = data[p.id] ?? {};
      return [
        p.id,
        `"${p.title}"`,
        `"${p.authors}"`,
        String(p.year),
        ...fields.map((f) => `"${d[f.id] ?? ''}"`),
      ].join(',');
    });
    const csv = [cols.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extracted_data.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [fields, papers, data]);

  const copyMarkdown = useCallback(() => {
    const cols = ['Paper', ...fields.map((f) => f.label)];
    const sep = cols.map(() => '---').join(' | ');
    const rows = papers.map((p) => {
      const d = data[p.id] ?? {};
      return [p.title.slice(0, 30), ...fields.map((f) => d[f.id] ?? '—')].join(' | ');
    });
    navigator.clipboard.writeText(
      `| ${cols.join(' | ')} |\n| ${sep} |\n${rows.map((r) => `| ${r} |`).join('\n')}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [fields, papers, data]);

  if (papers.length === 0) {
    return (
      <div className={styles.card} style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No included papers yet</div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>
          Mark papers as <Tag>Included</Tag> in Screening first.
        </div>
      </div>
    );
  }

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📋 Data Extraction Form</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            {papers.length} included papers · {filledCount} completed
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal>
          <Button icon={<Copy size={12} />} onClick={copyMarkdown}>
            {copied ? '✓ Copied!' : 'Copy Table'}
          </Button>
          <Button icon={<Download size={12} />} onClick={exportCSV} type={'primary'}>
            Export CSV
          </Button>
        </Flexbox>
      </Flexbox>

      <div
        style={{
          background: 'rgba(128,128,128,0.1)',
          borderRadius: 8,
          height: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: '#1890ff',
            borderRadius: 8,
            height: '100%',
            transition: 'width 0.3s',
            width: `${papers.length > 0 ? (filledCount / papers.length) * 100 : 0}%`,
          }}
        />
      </div>

      <Flexbox horizontal style={{ borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
        {(['extract', 'table', 'fields'] as const).map((tab) => (
          <div
            className={`${styles.tab}${activeTab === tab ? ' active' : ''}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'extract'
              ? '✏️ Extract per paper'
              : tab === 'table'
                ? '📊 Summary table'
                : '⚙️ Form fields'}
          </div>
        ))}
      </Flexbox>

      {activeTab === 'extract' && (
        <Flexbox gap={12}>
          <Select
            onChange={(v: string) => setSelectedPaper(v)}
            options={papers.map((p) => ({ label: p.title.slice(0, 70), value: p.id }))}
            style={{ width: '100%' }}
            value={selectedPaper}
          />
          {selectedPaper &&
            (() => {
              const paper = papers.find((p) => p.id === selectedPaper);
              if (!paper) return null;
              const d = data[selectedPaper] ?? {};
              return (
                <div className={styles.card}>
                  <Flexbox gap={10}>
                    <Flexbox gap={2}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{paper.title}</span>
                      <span style={{ fontSize: 10, opacity: 0.5 }}>
                        {paper.authors} · {paper.year}
                      </span>
                    </Flexbox>
                    {fields.map((field) => (
                      <Flexbox gap={2} key={field.id}>
                        <Flexbox align={'center'} gap={4} horizontal>
                          <span style={{ fontSize: 11, fontWeight: 600 }}>{field.label}</span>
                          {field.required && (
                            <span style={{ color: '#ff4d4f', fontSize: 10 }}>*</span>
                          )}
                        </Flexbox>
                        <FieldInput
                          field={field}
                          onChange={(v) => setVal(selectedPaper, field.id, v)}
                          value={d[field.id] ?? ''}
                        />
                      </Flexbox>
                    ))}
                  </Flexbox>
                </div>
              );
            })()}
        </Flexbox>
      )}

      {activeTab === 'table' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
            <thead>
              <tr>
                <th className={styles.tableHeader}>Paper</th>
                {fields.map((f) => (
                  <th className={styles.tableHeader} key={f.id}>
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {papers.map((p) => {
                const d = data[p.id] ?? {};
                return (
                  <tr key={p.id}>
                    <td className={styles.tableCell}>
                      <span style={{ fontWeight: 600 }}>{p.title.slice(0, 35)}…</span>
                    </td>
                    {fields.map((f) => (
                      <td
                        className={styles.tableCell}
                        key={f.id}
                        style={{
                          color: !d[f.id] && f.required ? '#ff4d4f' : 'inherit',
                          opacity: d[f.id] ? 1 : 0.3,
                        }}
                      >
                        {d[f.id] || (f.required ? '⚠ required' : '—')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'fields' && (
        <Flexbox gap={12}>
          {fields.map((field) => (
            <Flexbox align={'center'} gap={8} horizontal justify={'space-between'} key={field.id}>
              <span style={{ fontSize: 12 }}>{field.label}</span>
              <Flexbox gap={4} horizontal>
                <Tag style={{ fontSize: 9 }}>{field.type}</Tag>
                <Tag color={field.required ? 'red' : 'default'} style={{ fontSize: 9 }}>
                  {field.required ? 'required' : 'optional'}
                </Tag>
                <button
                  onClick={() => removeField(field.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    opacity: 0.4,
                  }}
                  type="button"
                >
                  <Trash2 size={12} />
                </button>
              </Flexbox>
            </Flexbox>
          ))}
          <Flexbox gap={8} horizontal wrap={'wrap'}>
            <input
              className={styles.field}
              onChange={(e) => setNewFieldLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addField()}
              placeholder="New field label..."
              style={{ maxWidth: 220 }}
              value={newFieldLabel}
            />
            <Select
              onChange={(v: FieldType) => setNewFieldType(v)}
              options={[
                { label: '📝 Text', value: 'text' },
                { label: '🔢 Number', value: 'number' },
                { label: '☑️ Yes/No', value: 'boolean' },
                { label: '📋 Select', value: 'select' },
                { label: '📅 Date', value: 'date' },
              ]}
              size="small"
              value={newFieldType}
            />
            <Button icon={<Plus size={12} />} onClick={addField}>
              Add Field
            </Button>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

DataExtractionForm.displayName = 'DataExtractionForm';
export default DataExtractionForm;
