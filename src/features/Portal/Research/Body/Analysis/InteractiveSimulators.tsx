'use client';

/**
 * MED-43: Interactive Biostatistics Simulators
 *
 * Three visual tools for medical research students:
 * 1. Normal Distribution — adjust μ and σ, see how the bell curve changes
 * 2. P-value Visualizer — see where your test statistic falls, shade significance area
 * 3. Power & Sample Size — explore the relationship between effect size, n, α, and power
 *
 * All rendered with inline SVG — no external chart libraries needed.
 */
import { createStyles } from 'antd-style';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

// ── Styles ─────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillQuaternary};
  `,
  container: css`
    width: 100%;
    max-width: 680px;
    margin-block: 0;
    margin-inline: auto;
    padding-block-start: 8px;
  `,
  label: css`
    font-size: 11px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
  pill: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 14px;
    border: 1.5px solid ${token.colorBorderSecondary};
    border-radius: 20px;

    font-size: 12px;
    font-weight: 600;
    color: ${token.colorText};

    background: ${token.colorBgContainer};

    transition: all 0.15s;

    &:hover {
      border-color: ${token.colorPrimary};
    }

    &.active {
      border-color: ${token.colorPrimary};
      color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  slider: css`
    width: 100%;
    accent-color: ${token.colorPrimary};
  `,
  stat: css`
    padding-block: 6px;
    padding-inline: 10px;
    border-radius: 8px;

    font-size: 12px;
    font-weight: 700;
    text-align: center;
  `,
  subtitle: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  title: css`
    font-size: 14px;
    font-weight: 700;
    color: ${token.colorText};
  `,
}));

// ── Math helpers ───────────────────────────────────────────────────────────
/** Standard normal PDF */
const normalPdf = (x: number, mu: number, sigma: number): number => {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
};

/** Approximate standard normal CDF */
const normalCdfApprox = (x: number): number => {
  const t = 1 / (1 + 0.231_641_9 * Math.abs(x));
  const d = 0.398_942_28;
  const p =
    d *
    Math.exp((-x * x) / 2) *
    t *
    (0.319_381_5 + t * (-0.356_563_8 + t * (1.781_478 + t * (-1.821_256 + t * 1.330_274))));
  return x > 0 ? 1 - p : p;
};

/** Inverse error function approximation */
const erfInv = (x: number): number => {
  const a = 0.147;
  const ln = Math.log(1 - x * x);
  const s = Math.sign(x);
  const t2 = 2 / (Math.PI * a) + ln / 2;
  return s * Math.sqrt(Math.sqrt(t2 * t2 - ln / a) - t2);
};

/** Power approximation: P(reject H0 | H1 true) for 2-sample t-test */
const calcPower = (n: number, effectSize: number, alpha: number): number => {
  const zAlpha = -Math.sqrt(2) * erfInv(2 * (1 - alpha / 2) - 1);
  const ncp = effectSize * Math.sqrt(n / 2);
  const power = 1 - normalCdfApprox(zAlpha - ncp);
  return Math.min(Math.max(power, 0), 1);
};

// ── Simulator modes ────────────────────────────────────────────────────────
type SimMode = 'distribution' | 'pvalue' | 'power';

const SIM_MODES: { emoji: string; id: SimMode; name: string }[] = [
  { emoji: '🔔', id: 'distribution', name: 'Phân phối chuẩn' },
  { emoji: '🎯', id: 'pvalue', name: 'P-value' },
  { emoji: '⚡', id: 'power', name: 'Power & cỡ mẫu' },
];

// ── SVG chart dimensions ───────────────────────────────────────────────────
const W = 560;
const H = 220;
const PAD = { bottom: 30, left: 40, right: 20, top: 15 };
const CW = W - PAD.left - PAD.right;
const CH = H - PAD.top - PAD.bottom;

// ── 1. Normal Distribution Simulator ───────────────────────────────────────
const DistributionSim = memo(() => {
  const { styles } = useStyles();
  const [mu, setMu] = useState(0);
  const [sigma, setSigma] = useState(1);

  const xMin = mu - 4 * sigma;
  const xMax = mu + 4 * sigma;
  const yMax = normalPdf(mu, mu, sigma) * 1.15;
  const POINTS = 200;

  const curvePoints = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= POINTS; i++) {
      const x = xMin + (i / POINTS) * (xMax - xMin);
      const y = normalPdf(x, mu, sigma);
      const sx = PAD.left + ((x - xMin) / (xMax - xMin)) * CW;
      const sy = PAD.top + CH - (y / yMax) * CH;
      pts.push(`${sx},${sy}`);
    }
    return pts.join(' ');
  }, [mu, sigma, xMin, xMax, yMax]);

  // Shade 68% region (μ ± 1σ)
  const shade68 = useMemo(() => {
    const pts: string[] = [];
    const lo = mu - sigma;
    const hi = mu + sigma;
    // bottom-left
    pts.push(`${PAD.left + ((lo - xMin) / (xMax - xMin)) * CW},${PAD.top + CH}`);
    for (let i = 0; i <= 80; i++) {
      const x = lo + (i / 80) * (hi - lo);
      const y = normalPdf(x, mu, sigma);
      const sx = PAD.left + ((x - xMin) / (xMax - xMin)) * CW;
      const sy = PAD.top + CH - (y / yMax) * CH;
      pts.push(`${sx},${sy}`);
    }
    pts.push(`${PAD.left + ((hi - xMin) / (xMax - xMin)) * CW},${PAD.top + CH}`);
    return pts.join(' ');
  }, [mu, sigma, xMin, xMax, yMax]);

  // X-axis ticks
  const xTicks = useMemo(() => {
    const ticks: { label: string; x: number }[] = [];
    for (let i = -3; i <= 3; i++) {
      const val = mu + i * sigma;
      ticks.push({ label: val.toFixed(1), x: PAD.left + ((val - xMin) / (xMax - xMin)) * CW });
    }
    return ticks;
  }, [mu, sigma, xMin, xMax]);

  return (
    <Flexbox gap={16}>
      <svg height={H} viewBox={`0 0 ${W} ${H}`} width="100%">
        {/* Grid */}
        <line
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + CH}
          y2={PAD.top + CH}
        />
        {/* 68% shaded area */}
        <polygon fill="rgba(99,226,183,0.2)" points={shade68} />
        {/* Curve */}
        <polyline fill="none" points={curvePoints} stroke="#63e2b7" strokeWidth={2.5} />
        {/* Mean line */}
        <line
          stroke="#63e2b7"
          strokeDasharray="4,3"
          strokeWidth={1}
          x1={PAD.left + CW / 2}
          x2={PAD.left + CW / 2}
          y1={PAD.top}
          y2={PAD.top + CH}
        />
        {/* X-axis ticks */}
        {xTicks.map((t) => (
          <g key={t.label}>
            <line
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1}
              x1={t.x}
              x2={t.x}
              y1={PAD.top + CH}
              y2={PAD.top + CH + 5}
            />
            <text
              fill="rgba(255,255,255,0.45)"
              fontSize={10}
              textAnchor="middle"
              x={t.x}
              y={PAD.top + CH + 18}
            >
              {t.label}
            </text>
          </g>
        ))}
        {/* Label */}
        <text
          fill="rgba(99,226,183,0.6)"
          fontSize={10}
          textAnchor="middle"
          x={PAD.left + CW / 2}
          y={PAD.top + CH + 28}
        >
          μ ± 1σ = 68.3%
        </text>
      </svg>

      {/* Sliders */}
      <Flexbox gap={12}>
        <Flexbox gap={4}>
          <Flexbox horizontal justify={'space-between'}>
            <span className={styles.label}>Trung bình (μ)</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{mu.toFixed(1)}</span>
          </Flexbox>
          <input
            className={styles.slider}
            max={10}
            min={-10}
            onChange={(e) => setMu(Number(e.target.value))}
            step={0.5}
            type="range"
            value={mu}
          />
        </Flexbox>
        <Flexbox gap={4}>
          <Flexbox horizontal justify={'space-between'}>
            <span className={styles.label}>Độ lệch chuẩn (σ)</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{sigma.toFixed(1)}</span>
          </Flexbox>
          <input
            className={styles.slider}
            max={5}
            min={0.2}
            onChange={(e) => setSigma(Number(e.target.value))}
            step={0.1}
            type="range"
            value={sigma}
          />
        </Flexbox>
      </Flexbox>

      {/* Stats */}
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        <span
          className={styles.stat}
          style={{ background: 'rgba(99,226,183,0.1)', color: '#63e2b7' }}
        >
          μ = {mu.toFixed(1)}
        </span>
        <span
          className={styles.stat}
          style={{ background: 'rgba(250,140,22,0.1)', color: '#fa8c16' }}
        >
          σ = {sigma.toFixed(1)}
        </span>
        <span
          className={styles.stat}
          style={{ background: 'rgba(22,119,255,0.1)', color: '#1677ff' }}
        >
          σ² = {(sigma * sigma).toFixed(2)}
        </span>
        <span
          className={styles.stat}
          style={{ background: 'rgba(114,46,209,0.1)', color: '#722ed1' }}
        >
          PDF(μ) = {normalPdf(mu, mu, sigma).toFixed(4)}
        </span>
      </Flexbox>
    </Flexbox>
  );
});
DistributionSim.displayName = 'DistributionSim';

// ── 2. P-value Simulator ───────────────────────────────────────────────────
const PValueSim = memo(() => {
  const { styles } = useStyles();
  const [zStat, setZStat] = useState(1.96);
  const [twoTailed, setTwoTailed] = useState(true);

  const pValue = useMemo(() => {
    const p = 1 - normalCdfApprox(Math.abs(zStat));
    return twoTailed ? 2 * p : p;
  }, [zStat, twoTailed]);

  const significant = pValue < 0.05;

  // Build curve + rejection area
  const xMin = -4;
  const xMax = 4;
  const yMax = normalPdf(0, 0, 1) * 1.15;

  const curvePoints = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 200; i++) {
      const x = xMin + (i / 200) * (xMax - xMin);
      const y = normalPdf(x, 0, 1);
      const sx = PAD.left + ((x - xMin) / (xMax - xMin)) * CW;
      const sy = PAD.top + CH - (y / yMax) * CH;
      pts.push(`${sx},${sy}`);
    }
    return pts.join(' ');
  }, [yMax]);

  // Rejection region (right tail from zStat to 4)
  const buildTailShade = useCallback(
    (from: number, to: number, color: string) => {
      const pts: string[] = [];
      const fromX = PAD.left + ((from - xMin) / (xMax - xMin)) * CW;
      const toX = PAD.left + ((to - xMin) / (xMax - xMin)) * CW;
      pts.push(`${fromX},${PAD.top + CH}`);
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const x = from + (i / steps) * (to - from);
        const y = normalPdf(x, 0, 1);
        const sx = PAD.left + ((x - xMin) / (xMax - xMin)) * CW;
        const sy = PAD.top + CH - (y / yMax) * CH;
        pts.push(`${sx},${sy}`);
      }
      pts.push(`${toX},${PAD.top + CH}`);
      return <polygon fill={color} key={`${from}-${to}`} points={pts.join(' ')} />;
    },
    [yMax],
  );

  const zStatX = PAD.left + ((zStat - xMin) / (xMax - xMin)) * CW;
  const zStatNegX = PAD.left + ((-zStat - xMin) / (xMax - xMin)) * CW;
  const tailColor = significant ? 'rgba(239,68,68,0.35)' : 'rgba(250,140,22,0.25)';

  return (
    <Flexbox gap={16}>
      <svg height={H} viewBox={`0 0 ${W} ${H}`} width="100%">
        <line
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + CH}
          y2={PAD.top + CH}
        />
        {/* Right tail */}
        {buildTailShade(Math.abs(zStat), 4, tailColor)}
        {/* Left tail (if two-tailed) */}
        {twoTailed && buildTailShade(-4, -Math.abs(zStat), tailColor)}
        {/* Curve */}
        <polyline fill="none" points={curvePoints} stroke="#63e2b7" strokeWidth={2} />
        {/* Z-stat line */}
        <line
          stroke="#ef4444"
          strokeDasharray="5,3"
          strokeWidth={1.5}
          x1={zStatX}
          x2={zStatX}
          y1={PAD.top}
          y2={PAD.top + CH}
        />
        <text
          fill="#ef4444"
          fontSize={10}
          fontWeight={700}
          textAnchor="middle"
          x={zStatX}
          y={PAD.top - 3}
        >
          z = {zStat.toFixed(2)}
        </text>
        {/* -Z line (two-tailed) */}
        {twoTailed && (
          <>
            <line
              stroke="#ef4444"
              strokeDasharray="5,3"
              strokeWidth={1.5}
              x1={zStatNegX}
              x2={zStatNegX}
              y1={PAD.top}
              y2={PAD.top + CH}
            />
            <text
              fill="#ef4444"
              fontSize={10}
              fontWeight={700}
              textAnchor="middle"
              x={zStatNegX}
              y={PAD.top - 3}
            >
              z = {(-zStat).toFixed(2)}
            </text>
          </>
        )}
        {/* X-axis labels */}
        {[-3, -2, -1, 0, 1, 2, 3].map((v) => {
          const tx = PAD.left + ((v - xMin) / (xMax - xMin)) * CW;
          return (
            <text
              fill="rgba(255,255,255,0.4)"
              fontSize={10}
              key={v}
              textAnchor="middle"
              x={tx}
              y={PAD.top + CH + 18}
            >
              {v}
            </text>
          );
        })}
      </svg>

      {/* Controls */}
      <Flexbox gap={12}>
        <Flexbox gap={4}>
          <Flexbox horizontal justify={'space-between'}>
            <span className={styles.label}>Z-statistic</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{zStat.toFixed(2)}</span>
          </Flexbox>
          <input
            className={styles.slider}
            max={4}
            min={0}
            onChange={(e) => setZStat(Number(e.target.value))}
            step={0.05}
            type="range"
            value={zStat}
          />
        </Flexbox>
        <Flexbox gap={8} horizontal>
          <button
            className={`${styles.pill} ${twoTailed ? 'active' : ''}`}
            onClick={() => setTwoTailed(true)}
            type="button"
          >
            ↔ Hai phía (Two-tailed)
          </button>
          <button
            className={`${styles.pill} ${!twoTailed ? 'active' : ''}`}
            onClick={() => setTwoTailed(false)}
            type="button"
          >
            → Một phía (One-tailed)
          </button>
        </Flexbox>
      </Flexbox>

      {/* Result */}
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        <span
          className={styles.stat}
          style={{
            background: significant ? 'rgba(239,68,68,0.15)' : 'rgba(250,140,22,0.1)',
            color: significant ? '#ef4444' : '#fa8c16',
            fontSize: 14,
          }}
        >
          p = {pValue < 0.0001 ? '< 0.0001' : pValue.toFixed(4)}
        </span>
        <span
          className={styles.stat}
          style={{
            background: significant ? 'rgba(239,68,68,0.1)' : 'rgba(82,196,26,0.1)',
            color: significant ? '#ef4444' : '#52c41a',
          }}
        >
          {significant ? '🔴 Ý nghĩa thống kê (p < 0.05)' : '🟢 Không có ý nghĩa (p ≥ 0.05)'}
        </span>
      </Flexbox>
    </Flexbox>
  );
});
PValueSim.displayName = 'PValueSim';

// ── 3. Power & Sample Size Simulator ───────────────────────────────────────
const PowerSim = memo(() => {
  const { styles } = useStyles();
  const [effectSize, setEffectSize] = useState(0.5);
  const [sampleN, setSampleN] = useState(30);
  const [alpha, setAlpha] = useState(0.05);

  const power = useMemo(() => calcPower(sampleN, effectSize, alpha), [sampleN, effectSize, alpha]);

  // Power curve (vary n from 5 to 200)
  const powerCurve = useMemo(() => {
    const pts: string[] = [];
    const nMin = 5;
    const nMax = 200;
    for (let i = 0; i <= 200; i++) {
      const n = nMin + (i / 200) * (nMax - nMin);
      const p = calcPower(Math.round(n), effectSize, alpha);
      const sx = PAD.left + (i / 200) * CW;
      const sy = PAD.top + CH - p * CH;
      pts.push(`${sx},${sy}`);
    }
    return pts.join(' ');
  }, [effectSize, alpha]);

  // Area under power curve
  const powerArea = useMemo(() => {
    const nMin = 5;
    const nMax = 200;
    const nFraction = (sampleN - nMin) / (nMax - nMin);
    const pts: string[] = [];
    const steps = Math.round(nFraction * 200);
    pts.push(`${PAD.left},${PAD.top + CH}`);
    for (let i = 0; i <= steps; i++) {
      const n = nMin + (i / 200) * (nMax - nMin);
      const p = calcPower(Math.round(n), effectSize, alpha);
      const sx = PAD.left + (i / 200) * CW;
      const sy = PAD.top + CH - p * CH;
      pts.push(`${sx},${sy}`);
    }
    pts.push(`${PAD.left + nFraction * CW},${PAD.top + CH}`);
    return pts.join(' ');
  }, [effectSize, alpha, sampleN]);

  // 80% power line
  const y80 = PAD.top + CH - 0.8 * CH;
  const nCurr = PAD.left + ((sampleN - 5) / 195) * CW;

  // Effect size labels
  const esLabel = effectSize < 0.3 ? 'Nhỏ' : effectSize < 0.6 ? 'Trung bình' : 'Lớn';
  const esColor = effectSize < 0.3 ? '#fa8c16' : effectSize < 0.6 ? '#1677ff' : '#52c41a';

  return (
    <Flexbox gap={16}>
      <svg height={H * 1.05} viewBox={`0 0 ${W} ${H * 1.05}`} width="100%">
        <line
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + CH}
          y2={PAD.top + CH}
        />
        {/* 80% power line */}
        <line
          stroke="rgba(250,140,22,0.3)"
          strokeDasharray="6,4"
          strokeWidth={1}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y80}
          y2={y80}
        />
        <text fill="rgba(250,140,22,0.5)" fontSize={9} x={W - PAD.right - 55} y={y80 - 4}>
          Power = 80%
        </text>
        {/* Shaded area */}
        <polygon fill="rgba(99,226,183,0.12)" points={powerArea} />
        {/* Power curve */}
        <polyline fill="none" points={powerCurve} stroke="#63e2b7" strokeWidth={2.5} />
        {/* Current n marker */}
        <line
          stroke="#63e2b7"
          strokeDasharray="3,2"
          strokeWidth={1}
          x1={nCurr}
          x2={nCurr}
          y1={PAD.top}
          y2={PAD.top + CH}
        />
        <circle cx={nCurr} cy={PAD.top + CH - power * CH} fill="#63e2b7" r={5} />
        <text
          fill="#63e2b7"
          fontSize={10}
          fontWeight={700}
          textAnchor="middle"
          x={nCurr}
          y={PAD.top + CH - power * CH - 10}
        >
          {(power * 100).toFixed(0)}%
        </text>
        {/* X-axis */}
        {[10, 50, 100, 150, 200].map((n) => {
          const tx = PAD.left + ((n - 5) / 195) * CW;
          return (
            <text
              fill="rgba(255,255,255,0.4)"
              fontSize={10}
              key={n}
              textAnchor="middle"
              x={tx}
              y={PAD.top + CH + 18}
            >
              {n}
            </text>
          );
        })}
        <text
          fill="rgba(255,255,255,0.3)"
          fontSize={10}
          textAnchor="middle"
          x={PAD.left + CW / 2}
          y={PAD.top + CH + 30}
        >
          Cỡ mẫu (n)
        </text>
        {/* Y-axis */}
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => {
          const ty = PAD.top + CH - p * CH;
          return (
            <g key={p}>
              <text
                fill="rgba(255,255,255,0.35)"
                fontSize={9}
                textAnchor="end"
                x={PAD.left - 6}
                y={ty + 3}
              >
                {(p * 100).toFixed(0)}%
              </text>
              <line
                stroke="rgba(255,255,255,0.04)"
                strokeWidth={1}
                x1={PAD.left}
                x2={W - PAD.right}
                y1={ty}
                y2={ty}
              />
            </g>
          );
        })}
      </svg>

      {/* Sliders */}
      <Flexbox gap={12}>
        <Flexbox gap={4}>
          <Flexbox horizontal justify={'space-between'}>
            <span className={styles.label}>Cỡ mẫu mỗi nhóm (n)</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{sampleN}</span>
          </Flexbox>
          <input
            className={styles.slider}
            max={200}
            min={5}
            onChange={(e) => setSampleN(Number(e.target.value))}
            step={1}
            type="range"
            value={sampleN}
          />
        </Flexbox>
        <Flexbox gap={4}>
          <Flexbox horizontal justify={'space-between'}>
            <span className={styles.label}>Effect Size (Cohen{"'s"} d)</span>
            <span style={{ color: esColor, fontSize: 13, fontWeight: 700 }}>
              {effectSize.toFixed(2)} — {esLabel}
            </span>
          </Flexbox>
          <input
            className={styles.slider}
            max={1.5}
            min={0.1}
            onChange={(e) => setEffectSize(Number(e.target.value))}
            step={0.05}
            type="range"
            value={effectSize}
          />
        </Flexbox>
        <Flexbox gap={4}>
          <Flexbox horizontal justify={'space-between'}>
            <span className={styles.label}>Mức ý nghĩa (α)</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{alpha}</span>
          </Flexbox>
          <input
            className={styles.slider}
            max={0.1}
            min={0.01}
            onChange={(e) => setAlpha(Number(e.target.value))}
            step={0.005}
            type="range"
            value={alpha}
          />
        </Flexbox>
      </Flexbox>

      {/* Stats */}
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        <span
          className={styles.stat}
          style={{
            background: power >= 0.8 ? 'rgba(82,196,26,0.12)' : 'rgba(239,68,68,0.12)',
            color: power >= 0.8 ? '#52c41a' : '#ef4444',
            fontSize: 14,
          }}
        >
          Power = {(power * 100).toFixed(1)}% {power >= 0.8 ? '✅ Đủ lực' : '⚠️ Thiếu lực'}
        </span>
        <span
          className={styles.stat}
          style={{ background: 'rgba(22,119,255,0.1)', color: '#1677ff' }}
        >
          n = {sampleN}/nhóm
        </span>
        <span className={styles.stat} style={{ background: `${esColor}15`, color: esColor }}>
          d = {effectSize.toFixed(2)}
        </span>
        <span
          className={styles.stat}
          style={{ background: 'rgba(114,46,209,0.1)', color: '#722ed1' }}
        >
          α = {alpha}
        </span>
      </Flexbox>
    </Flexbox>
  );
});
PowerSim.displayName = 'PowerSim';

// ── Main Component ─────────────────────────────────────────────────────────
const InteractiveSimulators = memo(() => {
  const { styles } = useStyles();
  const [mode, setMode] = useState<SimMode>('distribution');

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Mode selection */}
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        {SIM_MODES.map((m) => (
          <button
            className={`${styles.pill} ${mode === m.id ? 'active' : ''}`}
            key={m.id}
            onClick={() => setMode(m.id)}
            type="button"
          >
            <span>{m.emoji}</span>
            {m.name}
          </button>
        ))}
      </Flexbox>

      {/* Simulator */}
      <div className={styles.card}>
        {mode === 'distribution' && (
          <>
            <p className={styles.title}>🔔 Phân phối chuẩn (Normal Distribution)</p>
            <p className={styles.subtitle}>
              Kéo thanh trượt để thay đổi trung bình (μ) và độ lệch chuẩn (σ). Vùng tô màu = μ ± 1σ
              (68.3%).
            </p>
            <div style={{ marginTop: 12 }}>
              <DistributionSim />
            </div>
          </>
        )}
        {mode === 'pvalue' && (
          <>
            <p className={styles.title}>🎯 P-value Visualizer</p>
            <p className={styles.subtitle}>
              Nhập Z-statistic để thấy vùng bác bỏ H₀ (vùng đỏ) và giá trị p tương ứng.
            </p>
            <div style={{ marginTop: 12 }}>
              <PValueSim />
            </div>
          </>
        )}
        {mode === 'power' && (
          <>
            <p className={styles.title}>⚡ Power & Cỡ mẫu</p>
            <p className={styles.subtitle}>
              Explore mối quan hệ giữa cỡ mẫu (n), effect size (d), α, và power. Mục tiêu: Power ≥
              80%.
            </p>
            <div style={{ marginTop: 12 }}>
              <PowerSim />
            </div>
          </>
        )}
      </div>
    </Flexbox>
  );
});

InteractiveSimulators.displayName = 'InteractiveSimulators';
export default InteractiveSimulators;
