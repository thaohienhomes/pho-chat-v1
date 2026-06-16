'use client';

/**
 * NNT / NNH Calculator
 *
 * Calculates Number Needed to Treat (NNT) and Number Needed to Harm (NNH)
 * from various input formats:
 *   - Relative Risk (RR) + Control Event Rate (CER)
 *   - Odds Ratio (OR) + CER
 *   - Absolute Risk values (EER + CER)
 *   - Risk Difference (RD) directly
 *
 * Also computes: ARR, RRR, CI for NNT, clinical interpretation.
 * Used by clinicians to translate statistical results into clinical practice.
 */
import { Tag } from '@lobehub/ui';
import { InputNumber, Select } from 'antd';
import { createStyles } from 'antd-style';
import { AlertCircle, HeartPulse, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

type InputMode = 'rr_cer' | 'or_cer' | 'eer_cer' | 'rd';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  container: css`
    width: 100%;
  `,
  fieldRow: css`
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 10px;
    align-items: center;

    padding-block: 5px;
    padding-inline: 0;
  `,
  harm: css`
    padding: 20px;
    border: 2px solid #ff4d4f44;
    border-radius: ${token.borderRadiusLG}px;

    text-align: center;

    background: linear-gradient(135deg, #ff4d4f18, #ff4d4f08);
  `,
  nntPanel: css`
    padding: 20px;
    border: 2px solid ${token.colorPrimaryBorder};
    border-radius: ${token.borderRadiusLG}px;

    text-align: center;

    background: linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorFillQuaternary});
  `,
  number: css`
    font-size: 52px;
    font-weight: 900;
    line-height: 1;
  `,
}));

const normInv = (p: number): number => {
  const a = [2.515_517, 0.802_853, 0.010_328];
  const b = [1.432_788, 0.189_269, 0.001_308];
  const t = p <= 0.5 ? Math.sqrt(-2 * Math.log(p)) : Math.sqrt(-2 * Math.log(1 - p));
  const num = a[0] + a[1] * t + a[2] * t * t;
  const den = 1 + b[0] * t + b[1] * t * t + b[2] * t * t * t;
  return p <= 0.5 ? -(t - num / den) : t - num / den;
};

interface CalcResult {
  arr: number;
  ciHigh: number;
  ciLow: number;
  direction: 'benefit' | 'harm' | 'neutral';
  eer: number;
  nnt: number;
  rrr: number;
  type: 'NNT' | 'NNH';
}

const calcNNT = (
  mode: InputMode,
  vals: Record<string, number>,
  alpha: number,
): CalcResult | null => {
  try {
    let eer = 0,
      cer = 0;
    const z = normInv(1 - alpha / 2);

    switch (mode) {
      case 'rr_cer': {
        cer = vals['cer'];
        eer = vals['rr'] * cer;
        break;
      }
      case 'or_cer': {
        cer = vals['cer'];
        eer = (vals['or'] * cer) / (1 - cer + vals['or'] * cer);
        break;
      }
      case 'eer_cer': {
        eer = vals['eer'];
        cer = vals['cer'];
        break;
      }
      case 'rd': {
        const rd = vals['rd'];
        eer = 0.5 + rd / 2;
        cer = 0.5 - rd / 2;
        break;
      }
    }

    if (eer < 0 || eer > 1 || cer < 0 || cer > 1) return null;

    const arr = cer - eer; // positive = benefit
    const n = vals['n'] ?? 200;
    const se = Math.sqrt((eer * (1 - eer) + cer * (1 - cer)) / n);
    const rdLow = arr - z * se;
    const rdHigh = arr + z * se;

    if (Math.abs(arr) < 0.0001) return null;

    const nnt = Math.abs(1 / arr);
    const rrr = arr / cer;

    return {
      arr,
      ciHigh: 1 / Math.abs(rdLow < 0 ? rdHigh : rdHigh),
      ciLow: 1 / Math.abs(rdHigh < 0 ? rdLow : rdLow),
      direction: arr > 0.001 ? 'benefit' : arr < -0.001 ? 'harm' : 'neutral',
      eer,
      nnt,
      rrr,
      type: arr > 0 ? 'NNT' : 'NNH',
    };
  } catch {
    return null;
  }
};

const interpretNNT = (nnt: number, type: 'NNT' | 'NNH'): string => {
  const n = Math.ceil(nnt);
  if (type === 'NNT') {
    if (n <= 5)
      return `Excellent — treating ${n} patients prevents 1 bad outcome. Very high clinical impact.`;
    if (n <= 15)
      return `Good — treating ${n} patients prevents 1 bad outcome. Worthwhile in most settings.`;
    if (n <= 50)
      return `Moderate — treating ${n} patients to prevent 1 outcome. Assess cost/risk balance.`;
    return `Low — treating ${n} patients for 1 benefit. Consider carefully vs. side effects.`;
  }
  return `Caution — treating ${n} patients causes 1 additional harm. Weigh against benefit.`;
};

const NntCalculator = memo(() => {
  const { styles } = useStyles();
  const [mode, setMode] = useState<InputMode>('rr_cer');
  const [alpha, setAlpha] = useState(0.05);
  const [rr, setRr] = useState(0.72);
  const [or, setOr] = useState(0.65);
  const [cer, setCer] = useState(0.3);
  const [eer, setEer] = useState(0.18);
  const [rd, setRd] = useState(0.12);
  const [n, setN] = useState(500);

  const vals = useMemo(() => ({ cer, eer, n, or, rd, rr }), [rr, or, cer, eer, rd, n]);
  const result = useMemo(() => calcNNT(mode, vals, alpha), [mode, vals, alpha]);

  const reset = () => {
    setMode('rr_cer');
    setRr(0.72);
    setOr(0.65);
    setCer(0.3);
    setEer(0.18);
    setRd(0.12);
    setN(500);
  };

  const isHarm = result?.type === 'NNH';

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>🏥 NNT / NNH Calculator</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Number Needed to Treat / Harm — translate statistics to clinical practice
          </span>
        </Flexbox>
        <button
          onClick={reset}
          style={{
            alignItems: 'center',
            background: 'transparent',
            border: '1px solid',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex',
            fontSize: 12,
            gap: 4,
            padding: '4px 10px',
          }}
          type="button"
        >
          <RefreshCw size={11} /> Reset
        </button>
      </Flexbox>

      <Flexbox gap={16} horizontal style={{ alignItems: 'flex-start' }} wrap={'wrap'}>
        {/* Input panel */}
        <div className={styles.card} style={{ flex: '1', minWidth: 260 }}>
          <Flexbox gap={10}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>⚙️ Parameters</span>

            <div className={styles.fieldRow}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Input mode</span>
              <Select
                onChange={(v: InputMode) => setMode(v)}
                options={[
                  { label: '📊 RR + CER', value: 'rr_cer' },
                  { label: '⚖️ OR + CER', value: 'or_cer' },
                  { label: '🔢 EER + CER (raw rates)', value: 'eer_cer' },
                  { label: '📐 Risk Difference directly', value: 'rd' },
                ]}
                size="small"
                value={mode}
              />
            </div>

            {mode === 'rr_cer' && (
              <>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Relative Risk (RR)</span>
                  <InputNumber
                    max={10}
                    min={0.01}
                    onChange={(v) => v && setRr(v)}
                    size="small"
                    step={0.01}
                    style={{ width: '100%' }}
                    value={rr}
                  />
                </div>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Control Event Rate (CER)</span>
                  <InputNumber
                    max={0.99}
                    min={0.01}
                    onChange={(v) => v && setCer(v)}
                    size="small"
                    step={0.01}
                    style={{ width: '100%' }}
                    value={cer}
                  />
                </div>
              </>
            )}

            {mode === 'or_cer' && (
              <>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Odds Ratio (OR)</span>
                  <InputNumber
                    max={20}
                    min={0.01}
                    onChange={(v) => v && setOr(v)}
                    size="small"
                    step={0.01}
                    style={{ width: '100%' }}
                    value={or}
                  />
                </div>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Control Event Rate (CER)</span>
                  <InputNumber
                    max={0.99}
                    min={0.01}
                    onChange={(v) => v && setCer(v)}
                    size="small"
                    step={0.01}
                    style={{ width: '100%' }}
                    value={cer}
                  />
                </div>
              </>
            )}

            {mode === 'eer_cer' && (
              <>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    Experimental Event Rate (EER)
                  </span>
                  <InputNumber
                    max={0.99}
                    min={0.01}
                    onChange={(v) => v && setEer(v)}
                    size="small"
                    step={0.01}
                    style={{ width: '100%' }}
                    value={eer}
                  />
                </div>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Control Event Rate (CER)</span>
                  <InputNumber
                    max={0.99}
                    min={0.01}
                    onChange={(v) => v && setCer(v)}
                    size="small"
                    step={0.01}
                    style={{ width: '100%' }}
                    value={cer}
                  />
                </div>
              </>
            )}

            {mode === 'rd' && (
              <div className={styles.fieldRow}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Risk Difference (RD)</span>
                <InputNumber
                  max={0.99}
                  min={-0.99}
                  onChange={(v) => v !== null && setRd(v)}
                  size="small"
                  step={0.01}
                  style={{ width: '100%' }}
                  value={rd}
                />
              </div>
            )}

            <div className={styles.fieldRow}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Sample size (N, for CI)</span>
              <InputNumber
                min={10}
                onChange={(v) => v && setN(v)}
                size="small"
                step={50}
                style={{ width: '100%' }}
                value={n}
              />
            </div>
            <div className={styles.fieldRow}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Significance (α)</span>
              <Select
                onChange={(v: number) => setAlpha(v)}
                options={[
                  { label: 'α = 0.01', value: 0.01 },
                  { label: 'α = 0.05', value: 0.05 },
                  { label: 'α = 0.10', value: 0.1 },
                ]}
                size="small"
                value={alpha}
              />
            </div>
          </Flexbox>
        </div>

        {/* Result */}
        <div style={{ flex: '1', minWidth: 220 }}>
          {result ? (
            <Flexbox gap={12}>
              <div className={isHarm ? styles.harm : styles.nntPanel}>
                <Flexbox align={'center'} gap={4} style={{ marginBottom: 8 }}>
                  {isHarm ? (
                    <TrendingUp size={20} style={{ color: '#ff4d4f' }} />
                  ) : (
                    <TrendingDown size={20} style={{ color: '#1890ff' }} />
                  )}
                  <span
                    style={{ color: isHarm ? '#ff4d4f' : '#1890ff', fontSize: 13, fontWeight: 700 }}
                  >
                    {result.type}
                  </span>
                </Flexbox>
                <div className={styles.number} style={{ color: isHarm ? '#ff4d4f' : '#1890ff' }}>
                  {Math.ceil(result.nnt).toLocaleString()}
                </div>
                <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>
                  {isHarm
                    ? 'patients harmed per 1 additional harm'
                    : 'patients treated to prevent 1 event'}
                </div>
                <div style={{ fontSize: 10, marginTop: 8, opacity: 0.5 }}>
                  95% CI: {Math.ceil(result.ciLow).toLocaleString()} –{' '}
                  {Math.ceil(result.ciHigh).toLocaleString()}
                </div>
              </div>

              <div className={styles.card}>
                <Flexbox gap={8}>
                  <Flexbox gap={4} horizontal wrap={'wrap'}>
                    <Tag color="blue">ARR = {(Math.abs(result.arr) * 100).toFixed(1)}%</Tag>
                    <Tag color="green">RRR = {(Math.abs(result.rrr) * 100).toFixed(1)}%</Tag>
                    <Tag color="purple">EER = {(result.eer * 100).toFixed(1)}%</Tag>
                    <Tag>CER = {(cer * 100).toFixed(1)}%</Tag>
                  </Flexbox>
                  <Flexbox align={'flex-start'} gap={6} horizontal>
                    <HeartPulse
                      size={13}
                      style={{ color: '#1890ff', flexShrink: 0, marginTop: 1 }}
                    />
                    <span style={{ fontSize: 11 }}>{interpretNNT(result.nnt, result.type)}</span>
                  </Flexbox>
                </Flexbox>
              </div>
            </Flexbox>
          ) : (
            <div
              style={{
                alignItems: 'center',
                display: 'flex',
                gap: 8,
                minHeight: 120,
                opacity: 0.4,
              }}
            >
              <AlertCircle size={18} />
              <span style={{ fontSize: 12 }}>Adjust parameters — check rates are between 0–1</span>
            </div>
          )}
        </div>
      </Flexbox>

      {/* Reference table */}
      <div className={styles.card}>
        <Flexbox gap={6}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>
            📐 Clinical benchmarks (Laupacis 1988):
          </span>
          <Flexbox gap={4} horizontal wrap={'wrap'}>
            {[
              { color: '#52c41a', label: 'NNT ≤5', text: 'Excellent' },
              { color: '#1890ff', label: 'NNT 6–15', text: 'Good' },
              { color: '#faad14', label: 'NNT 16–50', text: 'Moderate' },
              { color: '#ff4d4f', label: 'NNT >50', text: 'Marginal' },
            ].map(({ label, color, text }) => (
              <Flexbox
                align={'center'}
                gap={4}
                horizontal
                key={label}
                style={{
                  background: `${color}12`,
                  border: `1px solid ${color}44`,
                  borderRadius: 4,
                  padding: '2px 8px',
                }}
              >
                <span style={{ color, fontSize: 10, fontWeight: 700 }}>{label}</span>
                <span style={{ fontSize: 10, opacity: 0.7 }}>{text}</span>
              </Flexbox>
            ))}
          </Flexbox>
        </Flexbox>
      </div>

      <div style={{ borderTop: '1px solid', fontSize: 10, opacity: 0.4, paddingTop: 6 }}>
        📚 Reference: Laupacis A, et al. An assessment of clinically useful measures of the
        consequences of treatment. NEJM 1988;318:1728–1733.
      </div>
    </Flexbox>
  );
});

NntCalculator.displayName = 'NntCalculator';
export default NntCalculator;
