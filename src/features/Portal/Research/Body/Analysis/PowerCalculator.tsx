'use client';

/**
 * Statistical Power Calculator
 * Sample size estimation for 5 study designs using normal approximation.
 * All computation is pure JS — no external libraries needed.
 */
import { Tag } from '@lobehub/ui';
import { InputNumber, Select, Slider } from 'antd';
import { createStyles } from 'antd-style';
import { AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

type StudyDesign = 'correlation' | 'odds_ratio' | 'proportions' | 'ttest_one' | 'ttest_two';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100%;
  `,
  fieldRow: css`
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 12px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 0;
  `,
  inputPanel: css`
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillQuaternary};
  `,
  resultPanel: css`
    padding: 20px;
    border: 2px solid ${token.colorPrimaryBorder};
    border-radius: ${token.borderRadiusLG}px;
    background: linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorFillQuaternary});
  `,
  sampleSize: css`
    font-size: 48px;
    font-weight: 900;
    line-height: 1;
    color: ${token.colorPrimary};
  `,
}));

// Beasley–Springer–Moro inverse normal CDF
const normInv = (p: number): number => {
  const a = [2.515_517, 0.802_853, 0.010_328];
  const b = [1.432_788, 0.189_269, 0.001_308];
  const t = p <= 0.5 ? Math.sqrt(-2 * Math.log(p)) : Math.sqrt(-2 * Math.log(1 - p));
  const num = a[0] + a[1] * t + a[2] * t * t;
  const den = 1 + b[0] * t + b[1] * t * t + b[2] * t * t * t;
  return p <= 0.5 ? -(t - num / den) : t - num / den;
};

const calculate = (
  design: StudyDesign,
  alpha: number,
  power: number,
  p: Record<string, number>,
) => {
  const za2 = normInv(1 - alpha / 2);
  const zb = normInv(power);
  const warns: string[] = [];
  let n = 0,
    formula = '',
    interp = '',
    perGroup = false;

  switch (design) {
    case 'ttest_two': {
      const d = p.delta / p.sd;
      if (!d) {
        warns.push('delta/sd cannot be 0');
        break;
      }
      n = Math.ceil(2 * ((za2 + zb) / d) ** 2);
      perGroup = true;
      formula = `n/group = 2×((${za2.toFixed(2)}+${zb.toFixed(2)})/${d.toFixed(2)})² = ${n}`;
      interp = `**${n}/group** (${n * 2} total). Cohen's d=${d.toFixed(2)} (${d < 0.2 ? 'small' : d < 0.5 ? 'small' : d < 0.8 ? 'medium' : 'large'})`;
      break;
    }
    case 'ttest_one': {
      const d = p.delta / p.sd;
      if (!d) {
        warns.push('delta/sd cannot be 0');
        break;
      }
      n = Math.ceil(((za2 + zb) / d) ** 2);
      formula = `n = ((${za2.toFixed(2)}+${zb.toFixed(2)})/${d.toFixed(2)})² = ${n}`;
      interp = `**${n} participants** (one-sample, Cohen's d=${d.toFixed(2)})`;
      break;
    }
    case 'proportions': {
      if (p.p1 === p.p2) {
        warns.push('p1 and p2 must differ');
        break;
      }
      const pbar = (p.p1 + p.p2) / 2;
      const num =
        (za2 * Math.sqrt(2 * pbar * (1 - pbar)) +
          zb * Math.sqrt(p.p1 * (1 - p.p1) + p.p2 * (1 - p.p2))) **
        2;
      n = Math.ceil(num / (p.p1 - p.p2) ** 2);
      perGroup = true;
      formula = `n/group = (Zα/2·√(2p̄q̄)+Zβ·√(p₁q₁+p₂q₂))²/(p₁−p₂)² = ${n}`;
      interp = `**${n}/group** (${n * 2} total). Δp=${Math.abs(p.p1 - p.p2).toFixed(3)}, NNT≈${Math.round(1 / Math.abs(p.p1 - p.p2))}`;
      break;
    }
    case 'odds_ratio': {
      if (p.or === 1) {
        warns.push('OR must ≠ 1');
        break;
      }
      const p2 = (p.or * p.p1) / (1 - p.p1 + p.or * p.p1);
      const pbar = (p.p1 + p2) / 2;
      const num =
        (za2 * Math.sqrt(2 * pbar * (1 - pbar)) +
          zb * Math.sqrt(p.p1 * (1 - p.p1) + p2 * (1 - p2))) **
        2;
      n = Math.ceil(num / (p.p1 - p2) ** 2);
      perGroup = true;
      formula = `p₂ from OR: ${p2.toFixed(3)}, n/group = ${n}`;
      interp = `**${n}/group** (${n * 2} total) for OR=${p.or} with p₀=${p.p1}`;
      break;
    }
    case 'correlation': {
      if (Math.abs(p.r) >= 1 || p.r === 0) {
        warns.push('r must be non-zero and |r|<1');
        break;
      }
      const fz = 0.5 * Math.log((1 + Math.abs(p.r)) / (1 - Math.abs(p.r)));
      n = Math.ceil(((za2 + zb) / fz) ** 2 + 3);
      formula = `n = ((${za2.toFixed(2)}+${zb.toFixed(2)})/Fisher_z(${p.r}))²+3 = ${n}`;
      interp = `**${n} participants** to detect r=${p.r} (${Math.abs(p.r) < 0.3 ? 'small' : Math.abs(p.r) < 0.5 ? 'medium' : 'large'})`;
      break;
    }
  }
  if (n > 10_000) warns.push('Very large N — reconsider effect size assumptions');
  if (n > 0 && n < 10) warns.push('Very small N — use exact methods');
  return { formula, interp, n, perGroup, warns };
};

const PowerCalculator = memo(() => {
  const { styles } = useStyles();
  const [design, setDesign] = useState<StudyDesign>('ttest_two');
  const [alpha, setAlpha] = useState(0.05);
  const [power, setPower] = useState(0.8);
  const [delta, setDelta] = useState(0.5);
  const [sd, setSd] = useState(1);
  const [p1, setP1] = useState(0.2);
  const [p2, setP2] = useState(0.35);
  const [or, setOr] = useState(2);
  const [r, setR] = useState(0.3);

  const params = useMemo(() => ({ delta, or, p1, p2, r, sd }), [delta, sd, p1, p2, or, r]);
  const result = useMemo(() => {
    try {
      return calculate(design, alpha, power, params);
    } catch {
      return null;
    }
  }, [design, alpha, power, params]);
  const reset = useCallback(() => {
    setDesign('ttest_two');
    setAlpha(0.05);
    setPower(0.8);
    setDelta(0.5);
    setSd(1);
    setP1(0.2);
    setP2(0.35);
    setOr(2);
    setR(0.3);
  }, []);

  const pctPower = Math.round(power * 100);

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>🔬 Statistical Power Calculator</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Sample size estimation — 5 study designs, pure JS (no software needed)
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
        {/* Inputs */}
        <div className={styles.inputPanel} style={{ flex: '1', minWidth: 260 }}>
          <Flexbox gap={10}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>⚙️ Parameters</span>
            <div className={styles.fieldRow}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Study design</span>
              <Select
                onChange={(v: StudyDesign) => setDesign(v)}
                options={[
                  { label: '📊 Two-sample t-test', value: 'ttest_two' },
                  { label: '📊 One-sample t-test', value: 'ttest_one' },
                  { label: '🔢 Two proportions (χ²)', value: 'proportions' },
                  { label: '⚕️ Odds ratio', value: 'odds_ratio' },
                  { label: '🔗 Correlation (r)', value: 'correlation' },
                ]}
                size="small"
                value={design}
              />
            </div>
            <div className={styles.fieldRow}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Significance (α)</span>
              <Select
                onChange={(v: number) => setAlpha(v)}
                options={[
                  { label: 'α = 0.01', value: 0.01 },
                  { label: 'α = 0.05 (standard)', value: 0.05 },
                  { label: 'α = 0.10', value: 0.1 },
                ]}
                size="small"
                value={alpha}
              />
            </div>
            <div className={styles.fieldRow}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Power: {pctPower}%</span>
              <Slider
                max={0.99}
                min={0.5}
                onChange={setPower}
                step={0.01}
                tooltip={{ formatter: (v) => `${Math.round((v ?? 0.8) * 100)}%` }}
                value={power}
              />
            </div>

            {(design === 'ttest_two' || design === 'ttest_one') && (
              <>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Mean difference (δ)</span>
                  <InputNumber
                    min={0.01}
                    onChange={(v) => v && setDelta(v)}
                    size="small"
                    step={0.1}
                    style={{ width: '100%' }}
                    value={delta}
                  />
                </div>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Std. deviation (σ)</span>
                  <InputNumber
                    min={0.01}
                    onChange={(v) => v && setSd(v)}
                    size="small"
                    step={0.1}
                    style={{ width: '100%' }}
                    value={sd}
                  />
                </div>
              </>
            )}

            {design === 'proportions' && (
              <>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Control rate (p₁)</span>
                  <InputNumber
                    max={0.99}
                    min={0.01}
                    onChange={(v) => v && setP1(v)}
                    size="small"
                    step={0.01}
                    style={{ width: '100%' }}
                    value={p1}
                  />
                </div>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Treatment rate (p₂)</span>
                  <InputNumber
                    max={0.99}
                    min={0.01}
                    onChange={(v) => v && setP2(v)}
                    size="small"
                    step={0.01}
                    style={{ width: '100%' }}
                    value={p2}
                  />
                </div>
              </>
            )}

            {design === 'odds_ratio' && (
              <>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Control rate (p₀)</span>
                  <InputNumber
                    max={0.99}
                    min={0.01}
                    onChange={(v) => v && setP1(v)}
                    size="small"
                    step={0.01}
                    style={{ width: '100%' }}
                    value={p1}
                  />
                </div>
                <div className={styles.fieldRow}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Detectable OR</span>
                  <InputNumber
                    min={0.01}
                    onChange={(v) => v && setOr(v)}
                    size="small"
                    step={0.1}
                    style={{ width: '100%' }}
                    value={or}
                  />
                </div>
              </>
            )}

            {design === 'correlation' && (
              <div className={styles.fieldRow}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Min detectable r</span>
                <InputNumber
                  max={0.99}
                  min={-0.99}
                  onChange={(v) => v !== null && setR(v)}
                  size="small"
                  step={0.05}
                  style={{ width: '100%' }}
                  value={r}
                />
              </div>
            )}
          </Flexbox>
        </div>

        {/* Result */}
        <div className={styles.resultPanel} style={{ flex: '1', minWidth: 220 }}>
          {result && result.n > 0 ? (
            <Flexbox gap={12}>
              <Flexbox align={'center'} gap={6} horizontal>
                <CheckCircle size={16} style={{ color: '#52c41a' }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Required Sample Size</span>
              </Flexbox>
              <Flexbox align={'baseline'} gap={6} horizontal>
                <span className={styles.sampleSize}>{result.n.toLocaleString()}</span>
                {result.perGroup && (
                  <span style={{ fontSize: 14, opacity: 0.7 }}>
                    /group · {(result.n * 2).toLocaleString()} total
                  </span>
                )}
              </Flexbox>
              <Flexbox gap={4} horizontal wrap={'wrap'}>
                <Tag color="blue">α = {(alpha * 100).toFixed(1)}%</Tag>
                <Tag color="green">Power = {pctPower}%</Tag>
                <Tag color="purple">β = {Math.round((1 - power) * 100)}%</Tag>
              </Flexbox>
              <div
                dangerouslySetInnerHTML={{
                  __html: result.interp.replaceAll(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
                }}
                style={{ fontSize: 11, fontStyle: 'italic', opacity: 0.8 }}
              />
              <div
                style={{
                  background: 'rgba(0,0,0,0.1)',
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 10,
                  opacity: 0.7,
                  padding: 8,
                }}
              >
                {result.formula}
              </div>
              {result.warns.map((w, i) => (
                <Flexbox align={'flex-start'} gap={6} horizontal key={i}>
                  <AlertCircle size={13} style={{ color: '#faad14', flexShrink: 0 }} />
                  <span style={{ color: '#faad14', fontSize: 11 }}>{w}</span>
                </Flexbox>
              ))}
              <div
                style={{
                  background: 'rgba(24,144,255,0.08)',
                  border: '1px solid rgba(24,144,255,0.2)',
                  borderRadius: 6,
                  fontSize: 11,
                  padding: 10,
                }}
              >
                📌 With 15% attrition buffer:{' '}
                <strong>
                  {Math.ceil(result.n * (result.perGroup ? 2 : 1) * 1.15).toLocaleString()}
                </strong>{' '}
                total to enroll
              </div>
            </Flexbox>
          ) : (
            <Flexbox align={'center'} gap={8} style={{ minHeight: 120, opacity: 0.4 }}>
              <AlertCircle size={20} />
              <span style={{ fontSize: 12 }}>
                {result?.warns?.[0] ?? 'Adjust parameters above'}
              </span>
            </Flexbox>
          )}
        </div>
      </Flexbox>

      <div style={{ borderTop: '1px solid', fontSize: 11, opacity: 0.5, paddingTop: 8 }}>
        📐 Formulas: Normal approximation (Kelsey 1996). For cluster RCT or survival analysis, use
        G*Power or R&apos;s pwr package.
      </div>
    </Flexbox>
  );
});

PowerCalculator.displayName = 'PowerCalculator';
export default PowerCalculator;
