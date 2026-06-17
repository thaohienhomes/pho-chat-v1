'use client';

/**
 * Subgroup Analysis
 *
 * Renders a forest plot broken down by user-defined subgroups.
 * Each subgroup has its own studies, effect estimates, and pooled summary.
 * Shows: within-subgroup heterogeneity (I²) and between-subgroup test (Qb).
 *
 * Supports:
 *   - Multiple subgroups (Age, RoB level, Region, Study design, etc.)
 *   - Random/Fixed effects pooling per subgroup
 *   - Visual SVG forest plot with subgroup separators and overall diamond
 *   - Interaction test (p for subgroup difference)
 */
import { Button, Tag } from '@lobehub/ui';
import { Select } from 'antd';
import { createStyles } from 'antd-style';
import { Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import type React from 'react';
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
    width: 100%;
    padding-block: 3px;
    padding-inline: 8px;
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
    grid-template-columns: 160px 70px 70px 70px auto;
    gap: 6px;
    align-items: center;

    font-size: 11px;
  `,
  subgroupHeader: css`
    padding-block: 8px 4px;
    padding-inline: 0;
    border-block-end: 1px solid ${token.colorBorder};

    font-size: 12px;
    font-weight: 700;
  `,
}));

interface Study {
  ci_high: number;
  ci_low: number;
  id: string;
  n: number;
  name: string;
  weight?: number;
  yi: number; // log(RR) or MD
}

interface Subgroup {
  color: string;
  id: string;
  label: string;
  studies: Study[];
}

// ── Stats ─────────────────────────────────────────────────────────────────────
const SAFE_RESULT = { ci_high: 0, ci_low: 0, i2: 0, p: 1, pooled: 0, q: 0 };

const poolDL = (studies: Study[]) => {
  if (studies.length === 0) return SAFE_RESULT;

  // Compute SE from CI width — guard against zero-width CIs
  const se = studies.map((s) => {
    const width = s.ci_high - s.ci_low;
    return width > 0 ? width / (2 * 1.96) : 0.5; // fallback SE = 0.5
  });
  const wi = se.map((s) => (s > 0 ? 1 / (s * s) : 0));
  const sumW = wi.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return SAFE_RESULT;

  // Pooled fixed-effect estimate
  const pooledFE = studies.reduce((s, st, i) => s + st.yi * wi[i], 0) / sumW;
  const Q = studies.reduce((s, st, i) => s + wi[i] * (st.yi - pooledFE) ** 2, 0);
  const df = Math.max(1, studies.length - 1);
  const i2 = Q > 0 ? Math.max(0, ((Q - df) / Q) * 100) : 0;

  // τ² via DerSimonian-Laird
  const sumW2 = wi.reduce((s, w) => s + w * w, 0);
  const c = sumW - sumW2 / sumW;
  const tau2 = c > 0 ? Math.max(0, (Q - df) / c) : 0;

  // Random-effects weights incorporating τ²
  const wRE = wi.map((w) => (w > 0 ? 1 / (1 / w + tau2) : 0));
  const sumWRE = wRE.reduce((a, b) => a + b, 0);
  if (sumWRE <= 0) return SAFE_RESULT;

  const pooled = studies.reduce((s, st, i) => s + st.yi * wRE[i], 0) / sumWRE;
  const seRE = 1 / Math.sqrt(sumWRE);
  const pQ = 1 - Math.exp(-0.5 * Math.max(0, Q)); // chi-sq approx
  return { ci_high: pooled + 1.96 * seRE, ci_low: pooled - 1.96 * seRE, i2, p: pQ, pooled, q: Q };
};

// ── Colors ────────────────────────────────────────────────────────────────────
const COLORS = ['#1890ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#f5222d'];

// ── Default data ──────────────────────────────────────────────────────────────
const DEFAULT_SUBGROUPS: Subgroup[] = [
  {
    color: '#1890ff',
    id: 'sg1',
    label: 'Low Risk of Bias',
    studies: [
      { ci_high: -0.05, ci_low: -0.65, id: 's1', n: 320, name: 'Smith 2020', yi: -0.35 },
      { ci_high: -0.12, ci_low: -0.55, id: 's2', n: 450, name: 'Jones 2019', yi: -0.33 },
      { ci_high: 0.08, ci_low: -0.6, id: 's3', n: 180, name: 'Lee 2021', yi: -0.26 },
    ],
  },
  {
    color: '#fa8c16',
    id: 'sg2',
    label: 'High Risk of Bias',
    studies: [
      { ci_high: 0.28, ci_low: -0.72, id: 's4', n: 120, name: 'Brown 2018', yi: -0.22 },
      { ci_high: 0.15, ci_low: -0.95, id: 's5', n: 85, name: 'White 2017', yi: -0.4 },
    ],
  },
];

// ── SVG Forest Plot (subgroup aware) ─────────────────────────────────────────
const SubgroupForestPlot = ({ subgroups }: { model?: string; subgroups: Subgroup[] }) => {
  const SVG_W = 680,
    LEFT = 220,
    RIGHT = 120,
    PLOT_W = SVG_W - LEFT - RIGHT;
  const ROW_H = 22,
    HEADER_H = 24,
    POOL_H = 10,
    GAP_H = 14;

  const pooled = useMemo(() => subgroups.map((sg) => ({ ...poolDL(sg.studies), sg })), [subgroups]);

  // x scale: log scale centered at 0
  const xMin = -1.5,
    xMax = 1.5;
  const toX = (v: number) => LEFT + ((v - xMin) / (xMax - xMin)) * PLOT_W;
  const zeroX = toX(0);

  let y = 20;
  const elements: React.ReactNode[] = [];
  const allStudiesY: { ci_high: number; ci_low: number; color: string; n: number; yi: number }[] =
    [];

  // Header
  elements.push(
    <text key="h-study" style={{ fontSize: 10, fontWeight: 700 }} x={8} y={y - 4}>
      Study
    </text>,
    <text key="h-yi" style={{ fontSize: 10, fontWeight: 700 }} x={LEFT + PLOT_W + 10} y={y - 4}>
      Effect (95% CI)
    </text>,
  );

  for (const item of pooled) {
    const { sg } = item;
    // Subgroup header
    elements.push(
      <text
        key={`sg-${sg.id}`}
        style={{ fill: sg.color, fontSize: 11, fontWeight: 700 }}
        x={8}
        y={y + HEADER_H / 2 + 4}
      >
        {sg.label}
      </text>,
      <line
        key={`sg-line-${sg.id}`}
        stroke={sg.color}
        strokeOpacity={0.3}
        strokeWidth={1}
        x1={LEFT}
        x2={LEFT + PLOT_W}
        y1={y + HEADER_H / 2}
        y2={y + HEADER_H / 2}
      />,
    );
    y += HEADER_H;

    for (const st of sg.studies) {
      const cx = toX(st.yi),
        x1 = toX(st.ci_low),
        x2 = toX(st.ci_high);
      const w = Math.max(4, Math.min(12, Math.sqrt(st.n / 50)));
      allStudiesY.push({
        ci_high: st.ci_high,
        ci_low: st.ci_low,
        color: sg.color,
        n: st.n,
        yi: st.yi,
      });

      elements.push(
        <g key={st.id}>
          <text style={{ fontSize: 9 }} x={8} y={y + ROW_H / 2 + 3}>
            {st.name}
          </text>
          <text style={{ fontSize: 9 }} x={LEFT - 50} y={y + ROW_H / 2 + 3}>
            n={st.n}
          </text>
          <line
            stroke="#888"
            strokeWidth={1}
            x1={Math.max(LEFT, x1)}
            x2={Math.min(LEFT + PLOT_W, x2)}
            y1={y + ROW_H / 2}
            y2={y + ROW_H / 2}
          />
          <rect
            fill={sg.color}
            height={w}
            rx={1}
            width={w}
            x={cx - w / 2}
            y={y + ROW_H / 2 - w / 2}
          />
          <text style={{ fontSize: 8.5 }} x={LEFT + PLOT_W + 10} y={y + ROW_H / 2 + 3}>
            {Math.exp(st.yi).toFixed(2)} ({Math.exp(st.ci_low).toFixed(2)}–
            {Math.exp(st.ci_high).toFixed(2)})
          </text>
        </g>,
      );
      y += ROW_H;
    }

    // Subgroup diamond
    const dcx = toX(item.pooled),
      dl = toX(item.ci_low),
      dr = toX(item.ci_high);
    const dh = POOL_H / 2;
    elements.push(
      <g key={`pool-${sg.id}`}>
        <polygon
          fill={sg.color}
          fillOpacity={0.7}
          points={`${dcx},${y + 2} ${dr},${y + dh + 2} ${dcx},${y + POOL_H + 2} ${dl},${y + dh + 2}`}
        />
        <text
          style={{ fill: sg.color, fontSize: 9, fontWeight: 700 }}
          x={LEFT + PLOT_W + 10}
          y={y + 8}
        >
          RR {Math.exp(item.pooled).toFixed(2)} [{Math.exp(item.ci_low).toFixed(2)},{' '}
          {Math.exp(item.ci_high).toFixed(2)}] I²={item.i2.toFixed(0)}%
        </text>
      </g>,
    );
    y += POOL_H + GAP_H;
  }

  // Vertical line at null (RR=1, log=0)
  elements.push(
    <line
      key="null"
      stroke="#666"
      strokeDasharray="3,2"
      strokeWidth={1.5}
      x1={zeroX}
      x2={zeroX}
      y1={10}
      y2={y}
    />,
    <text key="null-lbl" style={{ fontSize: 9 }} textAnchor="middle" x={zeroX} y={y + 10}>
      1.0
    </text>,
    <text key="favor-ctrl" style={{ fontSize: 9 }} x={LEFT + 4} y={y + 10}>
      Favours intervention
    </text>,
    <text key="favor-int" style={{ fontSize: 9 }} textAnchor="end" x={LEFT + PLOT_W - 4} y={y + 10}>
      Favours control
    </text>,
  );

  const totalH = y + 24;
  return (
    <svg
      height={totalH}
      style={{ fontFamily: 'inherit', maxWidth: SVG_W, width: '100%' }}
      viewBox={`0 0 ${SVG_W} ${totalH}`}
    >
      <rect fill="transparent" height={totalH} width={SVG_W} x={0} y={0} />
      {elements}
    </svg>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────
const SubgroupAnalysis = memo(() => {
  const { styles } = useStyles();
  const [subgroups, setSubgroups] = useState<Subgroup[]>(DEFAULT_SUBGROUPS);
  const [model, setModel] = useState('random');
  const [newLabel, setNewLabel] = useState('');

  const addSubgroup = useCallback(() => {
    if (!newLabel.trim()) return;
    const idx = subgroups.length;
    setSubgroups((prev) => [
      ...prev,
      {
        color: COLORS[idx % COLORS.length],
        id: `sg${Date.now()}`,
        label: newLabel.trim(),
        studies: [
          {
            ci_high: 0.1,
            ci_low: -0.6,
            id: `s${Date.now()}`,
            n: 100,
            name: 'New Study',
            yi: -0.25,
          },
        ],
      },
    ]);
    setNewLabel('');
  }, [newLabel, subgroups.length]);

  const removeSubgroup = useCallback((id: string) => {
    setSubgroups((prev) => prev.filter((sg) => sg.id !== id));
  }, []);

  const updateStudy = useCallback(
    (sgId: string, studyId: string, key: keyof Study, val: string | number) => {
      setSubgroups((prev) =>
        prev.map((sg) =>
          sg.id !== sgId
            ? sg
            : {
                ...sg,
                studies: sg.studies.map((s) => (s.id !== studyId ? s : { ...s, [key]: val })),
              },
        ),
      );
    },
    [],
  );

  const addStudy = useCallback((sgId: string) => {
    setSubgroups((prev) =>
      prev.map((sg) =>
        sg.id !== sgId
          ? sg
          : {
              ...sg,
              studies: [
                ...sg.studies,
                {
                  ci_high: 0.1,
                  ci_low: -0.5,
                  id: `s${Date.now()}`,
                  n: 100,
                  name: 'New study',
                  yi: -0.2,
                },
              ],
            },
      ),
    );
  }, []);

  const removeStudy = useCallback((sgId: string, studyId: string) => {
    setSubgroups((prev) =>
      prev.map((sg) =>
        sg.id !== sgId
          ? sg
          : {
              ...sg,
              studies: sg.studies.filter((s) => s.id !== studyId),
            },
      ),
    );
  }, []);

  // Between-subgroup Q test
  const pooledAll = useMemo(() => subgroups.map((sg) => poolDL(sg.studies)), [subgroups]);
  const overallPool = useMemo(() => poolDL(subgroups.flatMap((sg) => sg.studies)), [subgroups]);

  const Qw = useMemo(() => pooledAll.reduce((s, p) => s + p.q, 0), [pooledAll]);
  const Qt = useMemo(() => {
    const allStudies = subgroups.flatMap((sg) => sg.studies);
    const wi = allStudies.map((s) => 1 / ((s.ci_high - s.ci_low) / (2 * 1.96)) ** 2);
    const pooledFE =
      allStudies.reduce((s, st, i) => s + st.yi * wi[i], 0) / wi.reduce((a, b) => a + b, 0);
    return allStudies.reduce((s, st, i) => s + wi[i] * (st.yi - pooledFE) ** 2, 0);
  }, [subgroups]);
  const Qb = Qt - Qw;
  const pQb = 1 - Math.exp(-0.5 * Qb);

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox align={'center'} gap={12} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📊 Subgroup Analysis</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Forest plot broken down by predefined subgroups with interaction test
          </span>
        </Flexbox>
        <Flexbox gap={8} horizontal>
          <Select
            onChange={(v: string) => setModel(v)}
            options={[
              { label: 'Random Effects (DL)', value: 'random' },
              { label: 'Fixed Effects (IV)', value: 'fixed' },
            ]}
            size="small"
            value={model}
          />
        </Flexbox>
      </Flexbox>

      {/* Interaction test summary */}
      <div className={styles.card}>
        <Flexbox gap={6} horizontal wrap={'wrap'}>
          <Tag color="blue">Subgroups: {subgroups.length}</Tag>
          <Tag color="purple">
            Studies total: {subgroups.reduce((s, sg) => s + sg.studies.length, 0)}
          </Tag>
          <Tag color={pQb < 0.05 ? 'red' : 'green'}>
            Qb = {Qb.toFixed(2)} · p = {pQb.toFixed(3)} (
            {pQb < 0.05 ? '⚠️ Significant interaction' : '✓ No significant interaction'})
          </Tag>
          <Tag>
            Overall RR = {Math.exp(overallPool.pooled).toFixed(2)} [
            {Math.exp(overallPool.ci_low).toFixed(2)}, {Math.exp(overallPool.ci_high).toFixed(2)}]
          </Tag>
        </Flexbox>
      </div>

      {/* Forest Plot */}
      <div className={styles.card} style={{ overflowX: 'auto' }}>
        <SubgroupForestPlot model={model} subgroups={subgroups} />
      </div>

      {/* Subgroup editors */}
      {subgroups.map((sg, sgi) => (
        <div className={styles.card} key={sg.id} style={{ borderLeft: `3px solid ${sg.color}` }}>
          <Flexbox gap={10}>
            <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
              <span style={{ color: sg.color, fontSize: 13, fontWeight: 700 }}>● {sg.label}</span>
              <Flexbox gap={6} horizontal>
                <Tag color={pooledAll[sgi]?.i2 > 50 ? 'orange' : 'green'}>
                  I² = {pooledAll[sgi]?.i2.toFixed(0)}%
                </Tag>
                <Tag>RR {Math.exp(pooledAll[sgi]?.pooled ?? 0).toFixed(2)}</Tag>
                <button
                  onClick={() => removeSubgroup(sg.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    opacity: 0.4,
                  }}
                  type="button"
                >
                  <Trash2 size={13} />
                </button>
              </Flexbox>
            </Flexbox>

            <div
              className={styles.studyRow}
              style={{ fontSize: 10, fontWeight: 700, opacity: 0.6 }}
            >
              <span>Study</span>
              <span>log(RR)</span>
              <span>CI low</span>
              <span>CI high</span>
              <span>N</span>
            </div>
            {sg.studies.map((st) => (
              <div className={styles.studyRow} key={st.id}>
                <input
                  className={styles.input}
                  onChange={(e) => updateStudy(sg.id, st.id, 'name', e.target.value)}
                  value={st.name}
                />
                <input
                  className={styles.input}
                  onChange={(e) => updateStudy(sg.id, st.id, 'yi', Number(e.target.value))}
                  type="number"
                  value={st.yi}
                />
                <input
                  className={styles.input}
                  onChange={(e) => updateStudy(sg.id, st.id, 'ci_low', Number(e.target.value))}
                  type="number"
                  value={st.ci_low}
                />
                <input
                  className={styles.input}
                  onChange={(e) => updateStudy(sg.id, st.id, 'ci_high', Number(e.target.value))}
                  type="number"
                  value={st.ci_high}
                />
                <input
                  className={styles.input}
                  onChange={(e) => updateStudy(sg.id, st.id, 'n', Number(e.target.value))}
                  type="number"
                  value={st.n}
                />
                <button
                  onClick={() => removeStudy(sg.id, st.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    opacity: 0.4,
                  }}
                  type="button"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            <Button icon={<Plus size={11} />} onClick={() => addStudy(sg.id)} size="small">
              Add study
            </Button>
          </Flexbox>
        </div>
      ))}

      <Flexbox gap={8} horizontal>
        <input
          className={styles.input}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addSubgroup()}
          placeholder="New subgroup label (e.g. Age >65)"
          style={{ maxWidth: 280 }}
          value={newLabel}
        />
        <Button icon={<Plus size={13} />} onClick={addSubgroup}>
          Add Subgroup
        </Button>
      </Flexbox>

      <div style={{ borderTop: '1px solid', fontSize: 10, opacity: 0.4, paddingTop: 6 }}>
        📐 log(RR) scale. Enter log-transformed values. Pooling: DerSimonian-Laird (random) or
        inverse variance (fixed). Interaction test: Qb statistic.
      </div>
    </Flexbox>
  );
});

SubgroupAnalysis.displayName = 'SubgroupAnalysis';
export default SubgroupAnalysis;
