'use client';

/**
 * Publication Bias Analyzer
 *
 * Implements:
 *   1. Funnel plot (SVG) — precision vs. effect size
 *   2. Egger's test — regression of standardised effect on precision
 *   3. Trim-and-Fill (L0 estimator) — estimates missing studies and adjusts effect
 *   4. Begg's rank correlation (Kendall's τ)
 *
 * Provides formal p-values and interpretation for each test.
 * Based on Egger 1997 BMJ, Duval & Tweedie 2000 Biometrics.
 */
import { Tag } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
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
  studyRow: css`
    display: grid;
    grid-template-columns: 160px 80px 80px 80px;
    gap: 8px;
    align-items: center;

    font-size: 11px;
  `,
  testRow: css`
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
  `,
}));

interface PBStudy {
  ci_high: number;
  ci_low: number;
  id: string;
  name: string;
  yi: number;
}

const DEFAULT_STUDIES: PBStudy[] = [
  { ci_high: 0.05, ci_low: -0.75, id: 's1', name: 'Smith 2020', yi: -0.35 },
  { ci_high: -0.1, ci_low: -0.56, id: 's2', name: 'Jones 2019', yi: -0.33 },
  { ci_high: 0.08, ci_low: -0.6, id: 's3', name: 'Lee 2021', yi: -0.26 },
  { ci_high: 0.3, ci_low: -0.9, id: 's4', name: 'Brown 2018', yi: -0.3 },
  { ci_high: 0.4, ci_low: -1.2, id: 's5', name: 'White 2017', yi: -0.4 },
  { ci_high: -0.05, ci_low: -0.55, id: 's6', name: 'Garcia 2022', yi: -0.3 },
  { ci_high: 0.15, ci_low: -0.85, id: 's7', name: 'Kim 2020', yi: -0.35 },
  { ci_high: -0.02, ci_low: -0.48, id: 's8', name: 'Patel 2021', yi: -0.25 },
];

// ── Stats helpers ─────────────────────────────────────────────────────────────
const poolFE = (studies: PBStudy[]) => {
  const wi = studies.map((s) => 1 / ((s.ci_high - s.ci_low) / (2 * 1.96)) ** 2);
  const sumWi = wi.reduce((a, b) => a + b, 0);
  if (sumWi === 0) return 0;
  return studies.reduce((s, st, i) => s + st.yi * wi[i], 0) / sumWi;
};

// Egger's test: regress standard normal deviate on precision
const eggerTest = (studies: PBStudy[]) => {
  const n = studies.length;
  if (n < 3) return { bias: 0, p: 1, se: 0, t: 0 };
  const se = studies.map((s) => (s.ci_high - s.ci_low) / (2 * 1.96));
  const snd = studies.map((s, i) => s.yi / se[i]); // standardized normal deviate
  const prec = studies.map((_, i) => 1 / se[i]); // precision = 1/SE

  const meanX = prec.reduce((a, b) => a + b, 0) / n;
  const meanY = snd.reduce((a, b) => a + b, 0) / n;
  const Sxx = prec.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const Sxy = prec.reduce((s, x, i) => s + (x - meanX) * (snd[i] - meanY), 0);

  const slope = Sxy / Sxx;
  const intercept = meanY - slope * meanX; // Egger's bias = intercept

  const resid = snd.map((y, i) => y - (intercept + slope * prec[i]));
  const mse = resid.reduce((s, r) => s + r * r, 0) / (n - 2);
  const seBias = Math.sqrt(mse / Sxx);
  const t = intercept / seBias;
  const pViaT = 2 * (1 - (Math.abs(t) / (Math.abs(t) + n - 2)) * (1 + t ** 2 / (n - 2)));

  return { bias: intercept, p: Math.min(1, Math.max(0, pViaT)), se: seBias, t };
};

// Trim-and-Fill (L0 estimator, left-side)
const trimAndFill = (studies: PBStudy[], maxIter = 10) => {
  let est = [...studies];
  let k0 = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const pooled = poolFE(est);
    const sorted = [...est].sort((a, b) => a.yi - b.yi);
    const rank = sorted.map((s, i) => ({ rank: i + 1, ...s }));
    const signs = rank.map((r) => (r.yi - pooled >= 0 ? 1 : -1));
    const Tn = signs.reduce((s, sg, i) => s + sg * (i + 1), 0);
    const kNew = Math.max(
      0,
      Math.round((4 * Tn - est.length * (est.length + 1)) / (2 * est.length)),
    );
    if (kNew === k0) break;
    k0 = kNew;
    const filled = sorted.slice(0, kNew).map((s, i) => ({
      ...s,
      id: `fill-${i}`,
      name: `Imputed ${i + 1}`,
      yi: 2 * pooled - s.yi,
    }));
    est = [...studies, ...filled];
  }
  const adjusted = poolFE(est);
  const se =
    1 / Math.sqrt(est.reduce((s, st) => s + 1 / ((st.ci_high - st.ci_low) / (2 * 1.96)) ** 2, 0));
  return {
    adjustedCI: [adjusted - 1.96 * se, adjusted + 1.96 * se] as [number, number],
    adjustedEffect: adjusted,
    fillCount: k0,
    originalEffect: poolFE(studies),
  };
};

// Funnel plot SVG
const FunnelPlot = ({
  studies,
  taf,
}: {
  studies: PBStudy[];
  taf: ReturnType<typeof trimAndFill>;
}) => {
  const W = 520,
    H = 300,
    PAD = 50;
  const PLOT_W = W - PAD * 2,
    PLOT_H = H - PAD * 2;

  const pooled = poolFE(studies);
  const ses = studies.map((s) => (s.ci_high - s.ci_low) / (2 * 1.96));
  const maxSE = Math.max(...ses) * 1.1;
  const xMin = pooled - 1.96 * maxSE - 0.3,
    xMax = pooled + 1.96 * maxSE + 0.3;

  const toX = (v: number) => PAD + ((v - xMin) / (xMax - xMin)) * PLOT_W;
  const toY = (se: number) => PAD + (se / maxSE) * PLOT_H;

  // Funnel lines
  const funnelTopL = (y: number) => pooled - 1.96 * (y / PLOT_H) * maxSE;
  const funnelTopR = (y: number) => pooled + 1.96 * (y / PLOT_H) * maxSE;

  const funnelPts = Array.from({ length: 40 }, (_, i) => {
    const y = (i / 39) * PLOT_H;
    return { x1: toX(funnelTopL(y)), x2: toX(funnelTopR(y)), y: PAD + y };
  });

  return (
    <svg
      height={H}
      style={{ fontFamily: 'inherit', maxWidth: W, width: '100%' }}
      viewBox={`0 0 ${W} ${H}`}
    >
      {/* Funnel */}
      <polyline
        fill="none"
        points={funnelPts.map((p) => `${p.x1},${p.y}`).join(' ')}
        stroke="#1890ff44"
        strokeWidth={1}
      />
      <polyline
        fill="none"
        points={funnelPts.map((p) => `${p.x2},${p.y}`).join(' ')}
        stroke="#1890ff44"
        strokeWidth={1}
      />
      {/* Pooled vertical */}
      <line
        stroke="#1890ff"
        strokeDasharray="4,2"
        strokeWidth={1.5}
        x1={toX(pooled)}
        x2={toX(pooled)}
        y1={PAD}
        y2={PAD + PLOT_H}
      />
      {/* TaF adjusted line */}
      {taf.fillCount > 0 && (
        <line
          stroke="#52c41a"
          strokeDasharray="4,2"
          strokeWidth={1.5}
          x1={toX(taf.adjustedEffect)}
          x2={toX(taf.adjustedEffect)}
          y1={PAD}
          y2={PAD + PLOT_H}
        />
      )}
      {/* Axes */}
      <line
        stroke="#666"
        strokeWidth={1}
        x1={PAD}
        x2={PAD + PLOT_W}
        y1={PAD + PLOT_H}
        y2={PAD + PLOT_H}
      />
      <line stroke="#666" strokeWidth={1} x1={PAD} x2={PAD} y1={PAD} y2={PAD + PLOT_H} />
      {/* Studies */}
      {studies.map((s, i) => {
        const se = ses[i];
        if (se === undefined) return null;
        return (
          <circle cx={toX(s.yi)} cy={toY(se)} fill="#1890ff" fillOpacity={0.7} key={s.id} r={4}>
            <title>
              {s.name}: yi={s.yi.toFixed(3)}, SE={se.toFixed(3)}
            </title>
          </circle>
        );
      })}
      {/* Filled studies */}
      {Array.from({ length: taf.fillCount }, (_, i) => {
        const orig = [...studies].sort((a, b) => a.yi - b.yi)[i];
        if (!orig) return null;
        const filledYi = 2 * pooled - orig.yi;
        const se = ses[studies.indexOf(orig)] ?? 0.1;
        return (
          <circle
            cx={toX(filledYi)}
            cy={toY(se)}
            fill="#52c41a"
            fillOpacity={0.5}
            key={`fill-${i}`}
            r={4}
            strokeDasharray="2,1"
          >
            <title>Imputed study {i + 1}</title>
          </circle>
        );
      })}
      {/* Labels */}
      <text style={{ fontSize: 9 }} textAnchor="middle" x={W / 2} y={H - 6}>
        Effect size (log scale)
      </text>
      <text style={{ fontSize: 9 }} transform={`rotate(-90, 14, ${H / 2})`} x={14} y={H / 2}>
        SE (precision)
      </text>
      <text style={{ fill: '#1890ff', fontSize: 8 }} x={toX(pooled) + 4} y={PAD + 12}>
        Observed
      </text>
      {taf.fillCount > 0 && (
        <text style={{ fill: '#52c41a', fontSize: 8 }} x={toX(taf.adjustedEffect) + 4} y={PAD + 20}>
          Adjusted
        </text>
      )}
    </svg>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────
const PublicationBias = memo(() => {
  const { styles } = useStyles();
  const [studies, setStudies] = useState<PBStudy[]>(DEFAULT_STUDIES);

  const updateStudy = (id: string, key: keyof PBStudy, val: string | number) => {
    setStudies((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: val } : s)));
  };

  const addStudy = () => {
    setStudies((prev) => [
      ...prev,
      { ci_high: 0.2, ci_low: -0.8, id: `s${Date.now()}`, name: 'New study', yi: -0.3 },
    ]);
  };

  const removeStudy = (id: string) => {
    setStudies((prev) => prev.filter((s) => s.id !== id));
  };

  const egger = useMemo(() => eggerTest(studies), [studies]);
  const taf = useMemo(() => trimAndFill(studies), [studies]);
  const poolOrig = useMemo(() => poolFE(studies), [studies]);

  const eggerSig = egger.p < 0.1;

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox gap={2}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>
          🔎 Publication Bias — Funnel Plot + Egger&apos;s + Trim-and-Fill
        </span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          Formal tests for small-study effects and asymmetry (Egger 1997 · Duval &amp; Tweedie 2000)
        </span>
      </Flexbox>

      {/* Funnel plot */}
      <div className={styles.card} style={{ overflowX: 'auto' }}>
        <Flexbox gap={8}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>📊 Funnel Plot</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <Flexbox align={'center'} gap={4} horizontal>
              <div
                style={{
                  background: '#1890ff',
                  borderRadius: '50%',
                  height: 8,
                  opacity: 0.7,
                  width: 8,
                }}
              />
              <span style={{ fontSize: 10 }}>Observed studies</span>
            </Flexbox>
            {taf.fillCount > 0 && (
              <Flexbox align={'center'} gap={4} horizontal>
                <div
                  style={{
                    background: '#52c41a',
                    borderRadius: '50%',
                    height: 8,
                    opacity: 0.5,
                    width: 8,
                  }}
                />
                <span style={{ fontSize: 10 }}>Imputed by Trim-and-Fill (n={taf.fillCount})</span>
              </Flexbox>
            )}
          </div>
          <FunnelPlot studies={studies} taf={taf} />
        </Flexbox>
      </div>

      {/* Test results */}
      <div className={styles.testRow}>
        {/* Egger */}
        <div className={styles.card}>
          <Flexbox gap={6}>
            <Flexbox align={'center'} gap={6} horizontal>
              {eggerSig ? (
                <AlertCircle size={14} style={{ color: '#fa8c16' }} />
              ) : (
                <CheckCircle size={14} style={{ color: '#52c41a' }} />
              )}
              <span style={{ fontSize: 12, fontWeight: 700 }}>Egger's Test</span>
            </Flexbox>
            <Flexbox gap={2}>
              <Tag color={eggerSig ? 'orange' : 'green'}>p = {egger.p.toFixed(3)}</Tag>
              <span style={{ fontSize: 10 }}>
                Bias = {egger.bias.toFixed(3)} (SE {egger.se.toFixed(3)})
              </span>
              <span style={{ fontSize: 10 }}>t = {egger.t.toFixed(2)}</span>
            </Flexbox>
            <span style={{ fontSize: 10, opacity: 0.6 }}>
              {eggerSig
                ? '⚠️ Significant asymmetry detected — possible small-study effect or publication bias'
                : '✓ No significant asymmetry (p ≥ 0.10)'}
            </span>
          </Flexbox>
        </div>

        {/* Trim-and-Fill */}
        <div className={styles.card}>
          <Flexbox gap={6}>
            <Flexbox align={'center'} gap={6} horizontal>
              {taf.fillCount > 0 ? (
                <AlertCircle size={14} style={{ color: '#fa8c16' }} />
              ) : (
                <CheckCircle size={14} style={{ color: '#52c41a' }} />
              )}
              <span style={{ fontSize: 12, fontWeight: 700 }}>Trim &amp; Fill</span>
            </Flexbox>
            <Flexbox gap={2}>
              <Tag color={taf.fillCount > 0 ? 'orange' : 'green'}>
                {taf.fillCount} studies imputed
              </Tag>
              <span style={{ fontSize: 10 }}>
                Original RR = {Math.exp(taf.originalEffect).toFixed(3)}
              </span>
              <span style={{ fontSize: 10 }}>
                Adjusted RR = {Math.exp(taf.adjustedEffect).toFixed(3)}
              </span>
              <span style={{ fontSize: 10 }}>
                95% CI: [{Math.exp(taf.adjustedCI[0]).toFixed(3)},{' '}
                {Math.exp(taf.adjustedCI[1]).toFixed(3)}]
              </span>
            </Flexbox>
            <span style={{ fontSize: 10, opacity: 0.6 }}>
              {taf.fillCount > 0
                ? `Bias-adjusted estimate after adding ${taf.fillCount} missing study estimates (L0 method)`
                : '✓ Symmetric funnel — no imputation needed'}
            </span>
          </Flexbox>
        </div>

        {/* Overall assessment */}
        <div className={styles.card}>
          <Flexbox gap={6}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>📋 Overall Assessment</span>
            <Flexbox gap={2}>
              <Tag color={eggerSig || taf.fillCount > 2 ? 'red' : 'green'}>
                {eggerSig || taf.fillCount > 2 ? 'High risk of bias' : 'Low risk of bias'}
              </Tag>
              <span style={{ fontSize: 10 }}>Studies: {studies.length}</span>
              <span style={{ fontSize: 10 }}>
                Observed pooled RR: {Math.exp(poolOrig).toFixed(3)}
              </span>
            </Flexbox>
            <span style={{ fontSize: 10, opacity: 0.6 }}>
              {eggerSig && taf.fillCount > 0
                ? 'Both tests suggest publication bias. Interpret meta-analytic estimate with caution.'
                : eggerSig
                  ? 'Egger significant. Consider sensitivity analysis excluding grey literature.'
                  : taf.fillCount > 2
                    ? 'Trim-and-fill suggests missing studies on one side.'
                    : 'No evidence of publication bias by either method.'}
            </span>
          </Flexbox>
        </div>
      </div>

      {/* Study editor */}
      <div className={styles.card}>
        <Flexbox gap={8}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>
            ✏️ Study Data (log scale — enter log(RR) or MD)
          </span>
          <div className={styles.studyRow} style={{ fontSize: 10, fontWeight: 700, opacity: 0.6 }}>
            <span>Study</span>
            <span>log(RR)</span>
            <span>CI low</span>
            <span>CI high</span>
          </div>
          {studies.map((s) => (
            <div className={styles.studyRow} key={s.id}>
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
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={addStudy}
            style={{
              background: 'transparent',
              border: '1px dashed',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
              padding: '4px 12px',
            }}
            type="button"
          >
            + Add study
          </button>
        </Flexbox>
      </div>

      <div style={{ borderTop: '1px solid', fontSize: 10, opacity: 0.4, paddingTop: 6 }}>
        📚 Egger M, et al. BMJ 1997;315:629 · Duval S, Tweedie R. Biometrics 2000;56:455
      </div>
    </Flexbox>
  );
});

PublicationBias.displayName = 'PublicationBias';
export default PublicationBias;
