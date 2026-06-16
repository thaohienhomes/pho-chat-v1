'use client';

/**
 * PROSPERO Registration Helper
 *
 * Generates a PROSPERO-ready registration template pre-filled from the
 * current research store (PICO, search query, included papers).
 *
 * PROSPERO fields (simplified):
 *   1. Title
 *   2. Registration date
 *   3. Disease / Condition / Problem
 *   4. Population
 *   5. Intervention(s)
 *   6. Comparator(s) / Control
 *   7. Outcome(s)
 *   8. Data extraction / screening
 *   9. Risk of bias / Quality assessment
 *  10. Strategy for data synthesis
 *  11. Analysis of subgroups or subsets
 *  12. Type and method of review
 *  13. Language
 *  14. Country
 *  15. Other registration details / conflicts
 */
import { Button, Tag } from '@lobehub/ui';
import { Input, Select } from 'antd';
import { createStyles } from 'antd-style';
import { Copy, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useResearchStore } from '@/store/research';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProsperoField {
  help: string;
  id: string;
  label: string;
  multiline?: boolean;
  required?: boolean;
  value: string;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100%;
  `,
  fieldCard: css`
    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;

    background: ${token.colorFillQuaternary};
  `,
  fieldHelp: css`
    margin-block-start: 2px;
    font-size: 10px;
    color: ${token.colorTextTertiary};
  `,
  fieldLabel: css`
    font-size: 12px;
    font-weight: 700;
    color: ${token.colorText};
  `,
  preview: css`
    overflow: auto;

    max-height: 400px;
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    font-family: 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.7;
    color: ${token.colorText};
    white-space: pre-wrap;

    background: ${token.colorBgContainer};
  `,
  statsBar: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: ${token.borderRadiusLG}px;

    background: linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorFillQuaternary});
  `,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0];

const buildProsperoText = (fields: ProsperoField[]): string => {
  const lines = [
    'PROSPERO SYSTEMATIC REVIEW REGISTRATION',
    '=========================================',
    `Generated: ${today()} | Tool: Phở Chat Research Mode`,
    '',
    ...fields.map((f) => `## ${f.label}\n${f.value || '[Not specified]'}`),
    '',
    '=========================================',
    'Register at: https://www.crd.york.ac.uk/prospero/',
    'Note: Review and edit all fields before submission.',
  ];
  return lines.join('\n\n');
};

// ── Component ─────────────────────────────────────────────────────────────────
const ProsperoHelper = memo(() => {
  const { styles } = useStyles();

  const searchQuery = useResearchStore((s) => s.searchQuery);
  const pico = useResearchStore((s) => s.pico);
  const papers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);

  const includedCount = papers.filter(
    (p) => screeningDecisions[p.id]?.decision === 'included',
  ).length;

  const [reviewType, setReviewType] = useState<string>('Systematic review and meta-analysis');
  const [language, setLanguage] = useState<string>('English');
  const [country, setCountry] = useState<string>('Vietnam');
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  // Build initial fields from store
  const initialFields = useCallback(
    (): ProsperoField[] => [
      {
        help: 'Descriptive title identifying the condition and the intervention being reviewed',
        id: 'title',
        label: '1. Title',
        required: true,
        value: searchQuery ? `Systematic Review of ${searchQuery}` : '[Enter review title]',
      },
      {
        help: 'Name of the institution where the review is being conducted',
        id: 'institution',
        label: '2. Institutional or organisational affiliation',
        value: '[Institution name]',
      },
      {
        help: 'The specific disease, condition, or problem being reviewed',
        id: 'condition',
        label: '3. Disease or condition',
        required: true,
        value: pico?.population ?? searchQuery ?? '[Specify condition]',
      },
      {
        help: 'Characteristics of the population being studied',
        id: 'population',
        label: '4. Population',
        required: true,
        value: pico?.population
          ? `Adults/Patients with ${pico.population}`
          : '[Describe population: age, setting, condition]',
      },
      {
        help: 'The intervention(s) being reviewed',
        id: 'intervention',
        label: '5. Intervention(s)',
        required: true,
        value: pico?.intervention ?? '[Describe intervention]',
      },
      {
        help: 'Comparator or control condition',
        id: 'comparator',
        label: '6. Comparator(s) / Control',
        required: true,
        value: pico?.comparison ?? 'Placebo or standard care',
      },
      {
        help: 'Primary and secondary outcome measures',
        id: 'outcomes',
        label: '7. Outcome(s)',
        multiline: true,
        required: true,
        value: pico?.outcome
          ? `Primary: ${pico.outcome}\nSecondary: [List secondary outcomes]`
          : '[Specify primary and secondary outcomes]',
      },
      {
        help: 'Types of study designs to be included',
        id: 'studydesign',
        label: '8. Study designs to be included',
        value:
          'Randomized controlled trials (RCTs); controlled clinical trials; cohort studies (if RCTs unavailable)',
      },
      {
        help: 'Databases to be searched and search dates',
        id: 'databases',
        label: '9. Information sources',
        multiline: true,
        value: `PubMed/MEDLINE (1966–present)\nEmbase (1974–present)\nCochrane Central Register of Controlled Trials (CENTRAL)\nOpenAlex\nGrey literature: ClinicalTrials.gov, WHO ICTRP\n\nSearch query: ${searchQuery || '[Describe search strategy]'}`,
      },
      {
        help: 'Method for independently screening and extracting data',
        id: 'screening',
        label: '10. Data extraction / Screening process',
        multiline: true,
        value: `Two reviewers independently screened titles and abstracts, then full texts.\nDiscrepancies resolved by consensus or third reviewer.\nData extracted using standardised form.${includedCount > 0 ? `\n\nPreliminary search: ${papers.length} records identified; ${includedCount} potentially eligible.` : ''}`,
      },
      {
        help: 'Tool used to assess risk of bias in included studies',
        id: 'rob',
        label: '11. Risk of bias assessment',
        value:
          'Cochrane Risk of Bias 2 (RoB 2) for RCTs; ROBINS-I for non-randomised studies; NOS for observational studies',
      },
      {
        help: 'Planned approach to synthesis of results',
        id: 'synthesis',
        label: '12. Strategy for data synthesis',
        multiline: true,
        value:
          'Random-effects meta-analysis (DerSimonian–Laird) for outcomes with ≥3 studies reporting compatible data.\nHeterogeneity assessed with I² and Q statistic.\nSensitivity analysis: leave-one-out, fixed-effects model.\nFunnel plot and Egger test if ≥10 studies.\nNarrative synthesis if meta-analysis not appropriate.',
      },
      {
        help: 'Planned subgroup analyses',
        id: 'subgroup',
        label: '13. Analysis of subgroups or subsets',
        value:
          'Pre-specified subgroup analyses: age group; severity of condition; dose/duration of intervention; geographic region. Interaction tests reported.',
      },
      {
        help: 'Type of review (systematic review, meta-analysis, scoping review, etc.)',
        id: 'type',
        label: '14. Type and method of review',
        value: reviewType,
      },
      {
        help: 'Language restrictions on included studies',
        id: 'language',
        label: '15. Language',
        value: language,
      },
      {
        help: 'Country where the review is being conducted',
        id: 'country',
        label: '16. Country',
        value: country,
      },
      {
        help: 'Any other relevant details about the review',
        id: 'other',
        label: '17. Conflicts of interest and funding',
        value: 'No conflicts of interest declared. No funding received. [Amend as appropriate]',
      },
      {
        help: 'GRADE or similar approach to certainty of evidence',
        id: 'grade',
        label: '18. Certainty of evidence',
        value:
          'Certainty of evidence assessed using GRADE approach across five domains: risk of bias, inconsistency, indirectness, imprecision, publication bias.',
      },
    ],
    [searchQuery, pico, papers.length, includedCount, reviewType, language, country],
  );

  const [fields, setFields] = useState<ProsperoField[]>(initialFields);

  // Sync fields when PICO or query changes
  useEffect(() => {
    setFields(initialFields());
  }, [initialFields]);

  const updateField = useCallback((id: string, value: string) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value } : f)));
  }, []);

  const resetFields = useCallback(() => {
    setFields(initialFields());
  }, [initialFields]);

  const prosperoText = buildProsperoText(fields);
  const completedFields = fields.filter((f) => f.required && f.value && !f.value.includes('['));

  const copyText = useCallback(() => {
    navigator.clipboard.writeText(prosperoText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prosperoText]);

  const downloadText = useCallback(() => {
    const blob = new Blob([prosperoText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PROSPERO-registration.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [prosperoText]);

  const requiredFields = fields.filter((f) => f.required);

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📝 PROSPERO Registration Helper</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Pre-filled from your PICO and search query — edit fields then register at PROSPERO
          </span>
        </Flexbox>
        <Button
          icon={<ExternalLink size={12} />}
          onClick={() => window.open('https://www.crd.york.ac.uk/prospero/', '_blank')}
          size={'small'}
        >
          Open PROSPERO
        </Button>
      </Flexbox>

      {/* Stats bar */}
      <div className={styles.statsBar}>
        <Flexbox align={'center'} gap={8} horizontal justify={'space-between'} wrap={'wrap'}>
          <Flexbox gap={6} horizontal>
            <Tag color={completedFields.length === requiredFields.length ? 'green' : 'orange'}>
              {completedFields.length}/{requiredFields.length} required fields complete
            </Tag>
            {searchQuery && <Tag color="blue">Query: {searchQuery.slice(0, 30)}...</Tag>}
            {pico && <Tag color="purple">PICO loaded</Tag>}
            {includedCount > 0 && <Tag>{includedCount} included papers</Tag>}
          </Flexbox>
          <Flexbox gap={6} horizontal>
            <button
              onClick={resetFields}
              style={{
                alignItems: 'center',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 4,
                color: 'inherit',
                cursor: 'pointer',
                display: 'flex',
                fontSize: 11,
                gap: 4,
                padding: '2px 8px',
              }}
              type="button"
            >
              <RefreshCw size={10} /> Reset from PICO
            </button>
          </Flexbox>
        </Flexbox>
      </div>

      {/* Review type / language / country quick selectors */}
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        <Flexbox align={'center'} gap={4} horizontal>
          <span style={{ fontSize: 11, opacity: 0.6 }}>Review type:</span>
          <Select
            onChange={(v) => {
              setReviewType(v);
              updateField('type', v);
            }}
            options={[
              {
                label: 'Systematic review and meta-analysis',
                value: 'Systematic review and meta-analysis',
              },
              {
                label: 'Systematic review (narrative synthesis)',
                value: 'Systematic review (narrative synthesis)',
              },
              { label: 'Scoping review', value: 'Scoping review' },
              { label: 'Rapid review', value: 'Rapid review' },
              { label: 'Umbrella review', value: 'Umbrella review' },
            ]}
            size="small"
            value={reviewType}
          />
        </Flexbox>
        <Flexbox align={'center'} gap={4} horizontal>
          <span style={{ fontSize: 11, opacity: 0.6 }}>Language:</span>
          <Select
            onChange={(v) => {
              setLanguage(v);
              updateField('language', v);
            }}
            options={['English', 'English and Vietnamese', 'No restriction'].map((l) => ({
              label: l,
              value: l,
            }))}
            size="small"
            value={language}
          />
        </Flexbox>
        <Flexbox align={'center'} gap={4} horizontal>
          <span style={{ fontSize: 11, opacity: 0.6 }}>Country:</span>
          <Select
            onChange={(v) => {
              setCountry(v);
              updateField('country', v);
            }}
            options={[
              'Vietnam',
              'United Kingdom',
              'United States',
              'Australia',
              'Canada',
              'Germany',
            ].map((c) => ({ label: c, value: c }))}
            size="small"
            value={country}
          />
        </Flexbox>
      </Flexbox>

      {/* Field editors */}
      <Flexbox gap={8}>
        {fields.map((field) => (
          <div className={styles.fieldCard} key={field.id}>
            <Flexbox gap={4}>
              <Flexbox align={'center'} gap={6} horizontal>
                <span className={styles.fieldLabel}>{field.label}</span>
                {field.required && (
                  <Tag color="red" style={{ fontSize: 9 }}>
                    required
                  </Tag>
                )}
              </Flexbox>
              <div className={styles.fieldHelp}>{field.help}</div>
              {field.multiline ? (
                <Input.TextArea
                  autoSize={{ maxRows: 8, minRows: 2 }}
                  onChange={(e) => updateField(field.id, e.target.value)}
                  style={{ fontSize: 12, marginTop: 4 }}
                  value={field.value}
                />
              ) : (
                <Input
                  onChange={(e) => updateField(field.id, e.target.value)}
                  size="small"
                  style={{ fontSize: 12, marginTop: 4 }}
                  value={field.value}
                />
              )}
            </Flexbox>
          </div>
        ))}
      </Flexbox>

      {/* Actions */}
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        <Button icon={<Copy size={13} />} onClick={copyText} type={'primary'}>
          {copied ? '✓ Copied!' : 'Copy Registration Text'}
        </Button>
        <Button icon={<Download size={13} />} onClick={downloadText}>
          Download .txt
        </Button>
        <Button onClick={() => setShowPreview((p) => !p)}>
          {showPreview ? 'Hide Preview' : 'Preview Text'}
        </Button>
        <Button
          icon={<ExternalLink size={13} />}
          onClick={() =>
            window.open(
              'https://www.crd.york.ac.uk/prospero/display_record.php?RecordID=0',
              '_blank',
            )
          }
          style={{ marginLeft: 'auto' }}
        >
          Submit to PROSPERO →
        </Button>
      </Flexbox>

      {/* Preview */}
      {showPreview && <div className={styles.preview}>{prosperoText}</div>}

      {/* Footer note */}
      <div style={{ borderTop: '1px solid', fontSize: 11, opacity: 0.5, paddingTop: 8 }}>
        💡 <strong>Tip:</strong> Register your review <em>before</em> starting data extraction to
        avoid duplicate reviews. PROSPERO is free, hosted by University of York. Pre-registration
        helps prevent selective reporting and increases research credibility.
      </div>
    </Flexbox>
  );
});

ProsperoHelper.displayName = 'ProsperoHelper';
export default ProsperoHelper;
