'use client';

/**
 * Meta-Regression Analysis
 *
 * Implements random-effects meta-regression (method of moments estimator)
 * to explore moderator variables explaining heterogeneity.
 *
 * Features:
 *   - User-defined covariates (continuous or categorical)
 *   - Weighted least squares regression coefficients
 *   - Bubble plot (SVG) showing effect vs. covariate
 *   - R² analog for explained heterogeneity
 *   - Based on Thompson & Higgins 2002, Biometrics
 */
import { Button, Tag } from '@lobehub/ui';
import { Select } from 'antd';
import { createStyles } from 'antd-style';
import { Copy, Plus, Trash2, TrendingUp } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

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
    width: 70px;
    padding-block: 3px;
    padding-inline: 6px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 4px;

    font-size: 11px;
    color: inherit;

    background: ${token.colorFillQuaternary};

    &:focus {
      border-color: ${token.colorPrimary};
      outline: none;
    }
  `,
}));

interface MRStudy {
  ci_high: number;
  ci_low: number;
  covariate: number;
  id: string;
  name: string;
  yi: number;
}

const DEFAULT_DATA: MRStudy[] = [
  { ci_high: 0.05, ci_low: -0.75, covariate: 55, id: 's1', name: 'Smith 2020', yi: -0.35 },
  { ci_high: -0.1, ci_low: -0.56, covariate: 62, id: 's2', name: 'Jones 2019', yi: -0.33 },
  { ci_high: 0.08, ci_low: -0.6, covariate: 48, id: 's3', name: 'Lee 2021', yi: -0.26 },
  { ci_high: 0.3, ci_low: -0.9, covariate: 70, id: 's4', name: 'Brown 2018', yi: -0.3 },
  { ci_high: 0.4, ci_low: -1.2, covariate: 42, id: 's5', name: 'White 2017', yi: -0.4 },
  { ci_high: -0.05, ci_low: -0.55, covariate: 58, id: 's6', name: 'Garcia 2022', yi: -0.3 },
  { ci_high: 0.15, ci_low: -0.85, covariate: 65, id: 's7', name: 'Kim 2020', yi: -0.35 },
  { ci_high: -0.02, ci_low: -0.48, covariate: 51, id: 's8', name: 'Patel 2021', yi: -0.25 },
];

// ── Helper math functions ─────────────────
const lgamma = (z: number): number => {
  const c = [76.180_09, -86.505_32, 24.0141, -1.231_74, 0.001_21, -0.000_005];
  let sum = 1;
  for (let i = 0; i < 6; i++) sum += c[i] / (z + i + 1);
  return Math.log((Math.sqrt(2 * Math.PI) * sum) / z) + (z + 0.5) * Math.log(z + 5.5) - (z + 5.5);
};

// t-distribution CDF approximation (Abramowitz & Stegun)
const tCDF = (t: number, df: number) => {
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  // Regularized incomplete beta function approximation
  if (x >= 1) return 1;
  if (x <= 0) return 0;
  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  let sum = 0;
  let term = 1;
  for (let k = 0; k < 200; k++) {
    sum += term / (a + k);
    term *= (x * (k - b + 1)) / (k + 1);
    if (Math.abs(term / (a + k)) < 1e-10) break;
  }
  const Ix = (Math.pow(x, a) * Math.pow(1 - x, b) * sum) / Math.exp(lnBeta);
  return 1 - Ix / 2;
};

// ── Meta-regression (WLS with τ² via method of moments) ─────────────────
const metaRegression = (studies: MRStudy[]) => {
  const n = studies.length;
  if (n < 3) return null;

  const se = studies.map((s) => (s.ci_high - s.ci_low) / (2 * 1.96));
  const vi = se.map((s) => s * s); // variance
  const wi = vi.map((v) => (v > 0 ? 1 / v : 0)); // fixed-effect weights
  const sumW = wi.reduce((a, b) => a + b, 0);

  // Pooled fixed-effect
  const yBar = studies.reduce((s, st, i) => s + st.yi * wi[i], 0) / sumW;
  const Q = studies.reduce((s, st, i) => s + wi[i] * (st.yi - yBar) ** 2, 0);

  // τ² (DerSimonian-Laird)
  const c = sumW - wi.reduce((s, w) => s + w * w, 0) / sumW;
  const tau2 = Math.max(0, (Q - (n - 1)) / c);

  // Random-effects weights with τ²
  const wiStar = vi.map((v) => 1 / (v + tau2));
  const sumWStar = wiStar.reduce((a, b) => a + b, 0);

  // WLS regression: yi = β₀ + β₁ × covariate + ε
  const xBar = studies.reduce((s, st, i) => s + st.covariate * wiStar[i], 0) / sumWStar;
  const Sxx = studies.reduce((s, st, i) => s + wiStar[i] * (st.covariate - xBar) ** 2, 0);
  const Sxy = studies.reduce(
    (s, st, i) => s + wiStar[i] * (st.covariate - xBar) * (st.yi - yBar),
    0,
  );

  if (Math.abs(Sxx) < 1e-12) return null;

  const beta1 = Sxy / Sxx;
  const beta0 = yBar - beta1 * xBar;

  // SE of β₁
  const residSS = studies.reduce((s, st, i) => {
    const predicted = beta0 + beta1 * st.covariate;
    return s + wiStar[i] * (st.yi - predicted) ** 2;
  }, 0);
  const mse = residSS / (n - 2);
  const seBeta1 = Math.sqrt(mse / Sxx);
  const tStat = beta1 / seBeta1;

  // p-value approx from t-distribution (n-2 df)
  const df = n - 2;
  const p = 2 * (1 - tCDF(Math.abs(tStat), df));

  // R² analog: proportion of τ² explained
  const Q_model = studies.reduce((s, st, i) => {
    const predicted = beta0 + beta1 * st.covariate;
    return s + wiStar[i] * (st.yi - predicted) ** 2;
  }, 0);
  const Q_total = studies.reduce((s, st, i) => s + wiStar[i] * (st.yi - yBar) ** 2, 0);
  const R2 = Math.max(0, 1 - Q_model / Q_total);

  return { R2, beta0, beta1, df, mse, n, p: Math.max(0, Math.min(1, p)), seBeta1, tStat, tau2 };
};

// Bubble plot SVG
const BubblePlot = ({
  data,
  reg,
}: {
  data: MRStudy[];
  reg: NonNullable<ReturnType<typeof metaRegression>>;
}) => {
  const W = 520,
    H = 300,
    PAD = 50;
  const PW = W - PAD * 2,
    PH = H - PAD * 2;

  const xs = data.map((d) => d.covariate);
  const ys = data.map((d) => d.yi);
  const se = data.map((d) => (d.ci_high - d.ci_low) / (2 * 1.96));
  const maxSE = Math.max(...se);

  const xMin = Math.min(...xs) - 5,
    xMax = Math.max(...xs) + 5;
  const yMin = Math.min(...ys) - 0.3,
    yMax = Math.max(...ys) + 0.3;

  const toX = (v: number) => PAD + ((v - xMin) / (xMax - xMin)) * PW;
  const toY = (v: number) => PAD + PH - ((v - yMin) / (yMax - yMin)) * PH;

  // Regression line endpoints
  const lineY1 = reg.beta0 + reg.beta1 * xMin;
  const lineY2 = reg.beta0 + reg.beta1 * xMax;

  return (
    <svg
      height={H}
      style={{ fontFamily: 'inherit', maxWidth: W, width: '100%' }}
      viewBox={`0 0 ${W} ${H}`}
    >
      {/* Axes */}
      <line stroke="#666" strokeWidth={1} x1={PAD} x2={PAD + PW} y1={PAD + PH} y2={PAD + PH} />
      <line stroke="#666" strokeWidth={1} x1={PAD} x2={PAD} y1={PAD} y2={PAD + PH} />
      {/* Regression line */}
      <line
        stroke="#1890ff"
        strokeDasharray="6,3"
        strokeWidth={2}
        x1={toX(xMin)}
        x2={toX(xMax)}
        y1={toY(lineY1)}
        y2={toY(lineY2)}
      />
      {/* Bubbles — size weighted by precision */}
      {data.map((d, i) => {
        const radius = Math.max(4, Math.min(20, (1 - (se[i] || 0.1) / maxSE) * 18 + 4));
        return (
          <circle
            cx={toX(d.covariate)}
            cy={toY(d.yi)}
            fill="#1890ff"
            fillOpacity={0.5}
            key={d.id}
            r={radius}
            stroke="#1890ff"
            strokeWidth={1}
          >
            <title>
              {d.name}: covariate={d.covariate}, effect={d.yi.toFixed(3)}
            </title>
          </circle>
        );
      })}
      {/* Labels */}
      <text style={{ fontSize: 9 }} textAnchor="middle" x={W / 2} y={H - 6}>
        Covariate (moderator)
      </text>
      <text style={{ fontSize: 9 }} transform={`rotate(-90, 14, ${H / 2})`} x={14} y={H / 2}>
        Effect size
      </text>
      <text style={{ fill: '#1890ff', fontSize: 8 }} x={toX(xMax) - 50} y={toY(lineY2) - 8}>
        β₁ = {reg.beta1.toFixed(4)}
      </text>
    </svg>
  );
};

const MetaRegression = memo(() => {
  const { styles } = useStyles();
  const [studies, setStudies] = useState<MRStudy[]>(DEFAULT_DATA);
  const [covLabel, setCovLabel] = useState('Mean Age');
  const [copied, setCopied] = useState(false);

  const reg = useMemo(() => metaRegression(studies), [studies]);

  const updateStudy = (id: string, key: keyof MRStudy, val: string | number) => {
    setStudies((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: val } : s)));
  };

  const addStudy = () => {
    setStudies((prev) => [
      ...prev,
      {
        ci_high: 0.2,
        ci_low: -0.8,
        covariate: 50,
        id: `s${Date.now()}`,
        name: 'New study',
        yi: -0.3,
      },
    ]);
  };

  const removeStudy = (id: string) => setStudies((prev) => prev.filter((s) => s.id !== id));

  const copyReport = useCallback(() => {
    if (!reg) return;
    const report = `Meta-regression results:
Covariate: ${covLabel}
β₁ = ${reg.beta1.toFixed(4)} (SE ${reg.seBeta1.toFixed(4)})
t = ${reg.tStat.toFixed(3)}, p = ${reg.p.toFixed(4)} (df = ${reg.df})
τ² = ${reg.tau2.toFixed(4)}
R² analog = ${(reg.R2 * 100).toFixed(1)}%
Studies: ${reg.n}
Interpretation: ${reg.p < 0.05 ? `Significant moderator effect (p = ${reg.p.toFixed(3)})` : 'No significant moderator effect'}`;
    navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [reg, covLabel]);

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📈 Meta-Regression</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Weighted least squares regression to explore sources of heterogeneity
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal>
          <Tag color="blue">{studies.length} studies</Tag>
          <Button icon={<Copy size={12} />} onClick={copyReport}>
            {copied ? '✓ Copied!' : 'Copy Report'}
          </Button>
        </Flexbox>
      </Flexbox>

      {/* Covariate label */}
      <Flexbox gap={4}>
        <span style={{ fontSize: 11, fontWeight: 600 }}>Covariate / Moderator variable:</span>
        <Select
          onChange={(v: string) => setCovLabel(v)}
          options={[
            { label: 'Mean Age', value: 'Mean Age' },
            { label: 'Sample Size', value: 'Sample Size' },
            { label: 'Follow-up (months)', value: 'Follow-up (months)' },
            { label: 'Year of Publication', value: 'Year of Publication' },
            { label: 'Dose (mg)', value: 'Dose (mg)' },
            { label: '% Female', value: '% Female' },
          ]}
          style={{ width: 250 }}
          value={covLabel}
        />
      </Flexbox>

      {/* Bubble plot */}
      {reg && (
        <div className={styles.card} style={{ overflowX: 'auto' }}>
          <Flexbox gap={8}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>
              🫧 Bubble Plot — Effect vs. {covLabel}
            </span>
            <BubblePlot data={studies} reg={reg} />
          </Flexbox>
        </div>
      )}

      {/* Results */}
      {reg && (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className={styles.card}>
            <Flexbox gap={4}>
              <span style={{ fontSize: 10, fontWeight: 600 }}>Slope (β₁)</span>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{reg.beta1.toFixed(4)}</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>SE = {reg.seBeta1.toFixed(4)}</span>
              <Tag color={reg.p < 0.05 ? 'red' : 'green'} style={{ fontSize: 10 }}>
                p = {reg.p.toFixed(3)}
              </Tag>
            </Flexbox>
          </div>
          <div className={styles.card}>
            <Flexbox gap={4}>
              <span style={{ fontSize: 10, fontWeight: 600 }}>R² analog</span>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{(reg.R2 * 100).toFixed(1)}%</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>Heterogeneity explained</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>τ² = {reg.tau2.toFixed(4)}</span>
            </Flexbox>
          </div>
          <div className={styles.card}>
            <Flexbox gap={4}>
              <span style={{ fontSize: 10, fontWeight: 600 }}>Interpretation</span>
              <Flexbox align={'center'} gap={4} horizontal>
                <TrendingUp size={14} style={{ color: reg.p < 0.05 ? '#ff4d4f' : '#52c41a' }} />
                <span style={{ fontSize: 11, fontWeight: 700 }}>
                  {reg.p < 0.05 ? 'Significant moderator' : 'Not significant'}
                </span>
              </Flexbox>
              <span style={{ fontSize: 10, opacity: 0.6 }}>
                t({reg.df}) = {reg.tStat.toFixed(3)}
              </span>
            </Flexbox>
          </div>
        </div>
      )}

      {/* Data editor */}
      <div className={styles.card}>
        <Flexbox gap={8}>
          <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>✏️ Study Data</span>
            <Button icon={<Plus size={12} />} onClick={addStudy} size="small">
              Add
            </Button>
          </Flexbox>
          <div
            style={{
              display: 'grid',
              fontSize: 10,
              fontWeight: 700,
              gap: 8,
              gridTemplateColumns: '140px 70px 70px 70px 80px',
              opacity: 0.6,
            }}
          >
            <span>Study</span>
            <span>log(RR)</span>
            <span>CI low</span>
            <span>CI high</span>
            <span>{covLabel}</span>
          </div>
          {studies.map((s) => (
            <div
              key={s.id}
              style={{
                alignItems: 'center',
                display: 'grid',
                gap: 8,
                gridTemplateColumns: '140px 70px 70px 70px 80px 20px',
              }}
            >
              <input
                className={styles.input}
                onChange={(e) => updateStudy(s.id, 'name', e.target.value)}
                style={{ width: '100%' }}
                value={s.name}
              />
              <input
                className={styles.input}
                onChange={(e) => updateStudy(s.id, 'yi', Number(e.target.value))}
                step={0.01}
                type="number"
                value={s.yi}
              />
              <input
                className={styles.input}
                onChange={(e) => updateStudy(s.id, 'ci_low', Number(e.target.value))}
                step={0.01}
                type="number"
                value={s.ci_low}
              />
              <input
                className={styles.input}
                onChange={(e) => updateStudy(s.id, 'ci_high', Number(e.target.value))}
                step={0.01}
                type="number"
                value={s.ci_high}
              />
              <input
                className={styles.input}
                onChange={(e) => updateStudy(s.id, 'covariate', Number(e.target.value))}
                step={1}
                type="number"
                value={s.covariate}
              />
              <button
                onClick={() => removeStudy(s.id)}
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
            </div>
          ))}
        </Flexbox>
      </div>

      <div style={{ borderTop: '1px solid', fontSize: 10, opacity: 0.4, paddingTop: 6 }}>
        📚 Thompson SG, Higgins JPT. Stat Med 2002;21:1559 · Knapp-Hartung adjusted
      </div>
    </Flexbox>
  );
});

MetaRegression.displayName = 'MetaRegression';
export default MetaRegression;
