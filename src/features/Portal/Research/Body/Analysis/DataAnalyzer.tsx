'use client';

/**
 * MED-44: Data Upload + Auto-Analysis + Visualization
 *
 * Features:
 * 1. CSV/TSV drag-drop or file upload
 * 2. Auto-detect numeric columns
 * 3. Descriptive statistics (n, mean, SD, median, IQR, min, max, normality hint)
 * 4. Inline SVG visualizations: histogram + box plot per column
 * 5. Export summary as text
 *
 * 100% client-side — no server calls, no external chart libs.
 */
import { Button, Tag } from '@lobehub/ui';
import { Upload } from 'antd';
import { createStyles } from 'antd-style';
import { BarChart3, FileSpreadsheet, Upload as UploadIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

// ── Types ──────────────────────────────────────────────────────────────────
interface ColumnStats {
  count: number;
  iqr: number;
  max: number;
  mean: number;
  median: number;
  min: number;
  name: string;
  normalHint: string;
  q1: number;
  q3: number;
  sd: number;
  skewness: number;
  values: number[];
}

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
    max-width: 700px;
    margin-block: 0;
    margin-inline: auto;
    padding-block-start: 8px;
  `,
  dropZone: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;

    padding-block: 40px;
    padding-inline: 20px;
    border: 2px dashed ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};

    transition: all 0.2s;

    &:hover {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  label: css`
    font-size: 11px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
  sectionTitle: css`
    font-size: 13px;
    font-weight: 700;
    color: ${token.colorText};
  `,
  stat: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 11px;
    font-weight: 600;
    text-align: center;
  `,
  subtitle: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  tableCell: css`
    padding-block: 6px;
    padding-inline: 10px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    font-size: 12px;
    white-space: nowrap;
  `,
  tableHeader: css`
    padding-block: 6px;
    padding-inline: 10px;
    border-block-end: 2px solid ${token.colorBorderSecondary};

    font-size: 11px;
    font-weight: 700;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
  `,
  title: css`
    font-size: 14px;
    font-weight: 700;
    color: ${token.colorText};
  `,
}));

// ── Math helpers ───────────────────────────────────────────────────────────
const percentile = (sorted: number[], p: number): number => {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
};

const computeStats = (name: string, rawValues: number[]): ColumnStats => {
  const values = rawValues.filter((v) => !Number.isNaN(v));
  const n = values.length;
  if (n === 0) {
    return {
      count: 0,
      iqr: 0,
      max: 0,
      mean: 0,
      median: 0,
      min: 0,
      name,
      normalHint: '-',
      q1: 0,
      q3: 0,
      sd: 0,
      skewness: 0,
      values: [],
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1 || 1);
  const sd = Math.sqrt(variance);
  const median = percentile(sorted, 50);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  const skewness =
    n > 2 ? (values.reduce((a, v) => a + ((v - mean) / sd) ** 3, 0) * n) / ((n - 1) * (n - 2)) : 0;

  // Simple normality hint
  let normalHint = '❓ Chưa rõ';
  if (n >= 8) {
    if (Math.abs(skewness) < 0.5) normalHint = '✅ Có thể chuẩn';
    else if (Math.abs(skewness) < 1) normalHint = '⚠️ Hơi lệch';
    else normalHint = '❌ Lệch nhiều';
  }

  return {
    count: n,
    iqr,
    max: sorted[n - 1],
    mean,
    median,
    min: sorted[0],
    name,
    normalHint,
    q1,
    q3,
    sd,
    skewness,
    values: sorted,
  };
};

// ── SVG chart dimensions ───────────────────────────────────────────────────
const CW = 300;
const CHART_H = 120;
const BAR_PAD = 2;

// ── Mini Histogram ─────────────────────────────────────────────────────────
const MiniHistogram = memo<{ stats: ColumnStats }>(({ stats }) => {
  const bins = 15;
  const { max, min, values } = stats;
  const range = max - min || 1;
  const binWidth = range / bins;

  const counts = useMemo(() => {
    const c = Array.from<number>({ length: bins }).fill(0);
    for (const v of values) {
      const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
      c[idx]++;
    }
    return c;
  }, [values, min, binWidth, bins]);

  const maxCount = Math.max(...counts, 1);
  const barW = (CW - BAR_PAD * (bins - 1)) / bins;

  return (
    <svg height={CHART_H + 20} viewBox={`0 0 ${CW} ${CHART_H + 20}`} width="100%">
      {counts.map((c, i) => {
        const h = (c / maxCount) * CHART_H;
        const x = i * (barW + BAR_PAD);
        return (
          <g key={i}>
            <rect
              fill="rgba(99,226,183,0.5)"
              height={h}
              rx={2}
              width={barW}
              x={x}
              y={CHART_H - h}
            />
            {/* Hover title */}
            <title>{`${(min + i * binWidth).toFixed(1)}–${(min + (i + 1) * binWidth).toFixed(1)}: ${c}`}</title>
          </g>
        );
      })}
      {/* X-axis labels */}
      <text fill="rgba(255,255,255,0.4)" fontSize={9} textAnchor="start" x={0} y={CHART_H + 14}>
        {min.toFixed(1)}
      </text>
      <text fill="rgba(255,255,255,0.4)" fontSize={9} textAnchor="end" x={CW} y={CHART_H + 14}>
        {max.toFixed(1)}
      </text>
      <text
        fill="rgba(255,255,255,0.3)"
        fontSize={8}
        textAnchor="middle"
        x={CW / 2}
        y={CHART_H + 14}
      >
        n={stats.count}
      </text>
    </svg>
  );
});
MiniHistogram.displayName = 'MiniHistogram';

// ── Mini Box Plot ──────────────────────────────────────────────────────────
const MiniBoxPlot = memo<{ stats: ColumnStats }>(({ stats }) => {
  const { max, mean, median, min, q1, q3 } = stats;
  const range = max - min || 1;
  const toX = (v: number) => ((v - min) / range) * (CW - 20) + 10;
  const cy = 25;
  const boxH = 24;

  return (
    <svg height={60} viewBox={`0 0 ${CW} 60`} width="100%">
      {/* Whisker line */}
      <line
        stroke="rgba(255,255,255,0.25)"
        strokeWidth={1.5}
        x1={toX(min)}
        x2={toX(max)}
        y1={cy}
        y2={cy}
      />
      {/* Min/Max ticks */}
      <line
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={1.5}
        x1={toX(min)}
        x2={toX(min)}
        y1={cy - 8}
        y2={cy + 8}
      />
      <line
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={1.5}
        x1={toX(max)}
        x2={toX(max)}
        y1={cy - 8}
        y2={cy + 8}
      />
      {/* IQR box */}
      <rect
        fill="rgba(22,119,255,0.25)"
        height={boxH}
        rx={3}
        stroke="rgba(22,119,255,0.6)"
        strokeWidth={1.5}
        width={toX(q3) - toX(q1)}
        x={toX(q1)}
        y={cy - boxH / 2}
      />
      {/* Median line */}
      <line
        stroke="#fa8c16"
        strokeWidth={2}
        x1={toX(median)}
        x2={toX(median)}
        y1={cy - boxH / 2}
        y2={cy + boxH / 2}
      />
      {/* Mean dot */}
      <circle cx={toX(mean)} cy={cy} fill="#63e2b7" r={4} />
      {/* Labels */}
      <text fill="rgba(255,255,255,0.4)" fontSize={8} textAnchor="middle" x={toX(min)} y={52}>
        {min.toFixed(1)}
      </text>
      <text fill="rgba(22,119,255,0.7)" fontSize={8} textAnchor="middle" x={toX(q1)} y={52}>
        Q1
      </text>
      <text fill="#fa8c16" fontSize={8} textAnchor="middle" x={toX(median)} y={52}>
        Md
      </text>
      <text fill="rgba(22,119,255,0.7)" fontSize={8} textAnchor="middle" x={toX(q3)} y={52}>
        Q3
      </text>
      <text fill="rgba(255,255,255,0.4)" fontSize={8} textAnchor="middle" x={toX(max)} y={52}>
        {max.toFixed(1)}
      </text>
    </svg>
  );
});
MiniBoxPlot.displayName = 'MiniBoxPlot';

// ── CSV Parser ─────────────────────────────────────────────────────────────
const parseCSV = (text: string): { columns: string[]; rows: string[][] } => {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { columns: [], rows: [] };

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const columns = lines[0].split(delimiter).map((c) => c.trim().replaceAll('"', ''));
  const rows = lines
    .slice(1)
    .map((line) => line.split(delimiter).map((c) => c.trim().replaceAll('"', '')));
  return { columns, rows };
};

// ── Main Component ─────────────────────────────────────────────────────────
const DataAnalyzer = memo(() => {
  const { styles } = useStyles();
  const [fileName, setFileName] = useState('');
  const [allStats, setAllStats] = useState<ColumnStats[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [selectedCol, setSelectedCol] = useState<number>(0);
  const [vizMode, setVizMode] = useState<'box' | 'histogram'>('histogram');

  const handleFile = useCallback((file: File) => {
    void file.text().then((text) => {
      const { columns, rows } = parseCSV(text);
      setFileName(file.name);
      setRowCount(rows.length);

      // Compute stats for numeric columns only
      const stats: ColumnStats[] = [];
      for (const [i, colName] of columns.entries()) {
        const rawValues = rows.map((r) => Number.parseFloat(r[i]));
        const validCount = rawValues.filter((v) => !Number.isNaN(v)).length;
        if (validCount > rows.length * 0.5) {
          stats.push(computeStats(colName, rawValues));
        }
      }
      setAllStats(stats);
      setSelectedCol(0);
    });
    return false; // prevent antd upload
  }, []);

  const currentStats = allStats[selectedCol];

  const summaryText = useMemo(() => {
    if (allStats.length === 0) return '';
    return allStats
      .map(
        (s) =>
          `${s.name}: n=${s.count}, Mean=${s.mean.toFixed(2)}, SD=${s.sd.toFixed(2)}, Median=${s.median.toFixed(2)}, IQR=${s.iqr.toFixed(2)}, Min=${s.min.toFixed(2)}, Max=${s.max.toFixed(2)}, Skew=${s.skewness.toFixed(2)}`,
      )
      .join('\n');
  }, [allStats]);

  // ── Empty state ────────────────────────────────────────────────────────
  if (allStats.length === 0) {
    return (
      <Flexbox className={styles.container} gap={16}>
        <Flexbox gap={4}>
          <span className={styles.title}>📊 Phân tích dữ liệu</span>
          <span className={styles.subtitle}>
            Upload file CSV/TSV để tự động tính thống kê mô tả và trực quan hóa dữ liệu.
          </span>
        </Flexbox>
        <Upload.Dragger
          accept=".csv,.tsv,.txt"
          beforeUpload={handleFile}
          className={styles.dropZone}
          showUploadList={false}
        >
          <UploadIcon color="rgba(99,226,183,0.6)" size={36} />
          <p style={{ fontSize: 13, fontWeight: 600 }}>Kéo thả file hoặc click để chọn</p>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
            Hỗ trợ: .csv, .tsv, .txt (dòng đầu = tên cột)
          </p>
        </Upload.Dragger>

        {/* Sample data hint */}
        <div className={styles.card} style={{ fontSize: 12 }}>
          <p className={styles.label}>💡 Mẫu dữ liệu</p>
          <code
            style={{
              display: 'block',
              fontSize: 11,
              lineHeight: 1.8,
              marginTop: 6,
              opacity: 0.7,
              whiteSpace: 'pre',
            }}
          >
            {`Age,SBP,DBP,BMI,Cholesterol
45,130,85,24.5,210
52,145,92,28.1,245
38,120,78,22.3,195
61,155,98,31.2,268`}
          </code>
        </div>
      </Flexbox>
    );
  }

  // ── Results view ───────────────────────────────────────────────────────
  return (
    <Flexbox className={styles.container} gap={16}>
      {/* File info header */}
      <Flexbox align={'center'} gap={10} horizontal justify={'space-between'}>
        <Flexbox align={'center'} gap={8} horizontal>
          <FileSpreadsheet color="#63e2b7" size={18} />
          <span className={styles.title}>{fileName}</span>
          <Tag bordered={false} style={{ fontSize: 11 }}>
            {rowCount} dòng · {allStats.length} cột số
          </Tag>
        </Flexbox>
        <button
          onClick={() => {
            setAllStats([]);
            setFileName('');
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: 11,
          }}
          type="button"
        >
          🔄 Đổi file
        </button>
      </Flexbox>

      {/* Summary table */}
      <div className={styles.card} style={{ overflow: 'auto' }}>
        <p className={styles.label} style={{ marginBottom: 8 }}>
          📋 Thống kê mô tả
        </p>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {['Biến', 'n', 'Mean', 'SD', 'Median', 'IQR', 'Min', 'Max', 'Skew', 'PP Chuẩn'].map(
                (h) => (
                  <th className={styles.tableHeader} key={h}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {allStats.map((s, i) => (
              <tr
                key={s.name}
                onClick={() => setSelectedCol(i)}
                style={{
                  background: i === selectedCol ? 'rgba(99,226,183,0.08)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
              >
                <td className={styles.tableCell} style={{ fontWeight: 700 }}>
                  {s.name}
                </td>
                <td className={styles.tableCell}>{s.count}</td>
                <td className={styles.tableCell}>{s.mean.toFixed(2)}</td>
                <td className={styles.tableCell}>{s.sd.toFixed(2)}</td>
                <td className={styles.tableCell}>{s.median.toFixed(2)}</td>
                <td className={styles.tableCell}>{s.iqr.toFixed(2)}</td>
                <td className={styles.tableCell}>{s.min.toFixed(2)}</td>
                <td className={styles.tableCell}>{s.max.toFixed(2)}</td>
                <td className={styles.tableCell}>{s.skewness.toFixed(2)}</td>
                <td className={styles.tableCell}>{s.normalHint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Visualization */}
      {currentStats && (
        <div className={styles.card}>
          <Flexbox
            align={'center'}
            gap={10}
            horizontal
            justify={'space-between'}
            style={{ marginBottom: 12 }}
          >
            <Flexbox align={'center'} gap={6} horizontal>
              <BarChart3 color="#63e2b7" size={14} />
              <span className={styles.sectionTitle}>{currentStats.name}</span>
            </Flexbox>
            <Flexbox gap={6} horizontal>
              <button
                onClick={() => setVizMode('histogram')}
                style={{
                  background: vizMode === 'histogram' ? 'rgba(99,226,183,0.15)' : 'transparent',
                  border: '1px solid',
                  borderColor:
                    vizMode === 'histogram' ? 'rgba(99,226,183,0.4)' : 'rgba(255,255,255,0.1)',
                  borderRadius: 6,
                  color: vizMode === 'histogram' ? '#63e2b7' : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: '3px 10px',
                }}
                type="button"
              >
                📊 Histogram
              </button>
              <button
                onClick={() => setVizMode('box')}
                style={{
                  background: vizMode === 'box' ? 'rgba(22,119,255,0.15)' : 'transparent',
                  border: '1px solid',
                  borderColor: vizMode === 'box' ? 'rgba(22,119,255,0.4)' : 'rgba(255,255,255,0.1)',
                  borderRadius: 6,
                  color: vizMode === 'box' ? '#1677ff' : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: '3px 10px',
                }}
                type="button"
              >
                📦 Box Plot
              </button>
            </Flexbox>
          </Flexbox>

          {vizMode === 'histogram' ? (
            <MiniHistogram stats={currentStats} />
          ) : (
            <MiniBoxPlot stats={currentStats} />
          )}

          {/* Quick stats row */}
          <Flexbox gap={6} horizontal style={{ marginTop: 10 }} wrap={'wrap'}>
            <span
              className={styles.stat}
              style={{ background: 'rgba(99,226,183,0.1)', color: '#63e2b7' }}
            >
              μ = {currentStats.mean.toFixed(2)}
            </span>
            <span
              className={styles.stat}
              style={{ background: 'rgba(250,140,22,0.1)', color: '#fa8c16' }}
            >
              σ = {currentStats.sd.toFixed(2)}
            </span>
            <span
              className={styles.stat}
              style={{ background: 'rgba(22,119,255,0.1)', color: '#1677ff' }}
            >
              Md = {currentStats.median.toFixed(2)}
            </span>
            <span
              className={styles.stat}
              style={{ background: 'rgba(114,46,209,0.1)', color: '#722ed1' }}
            >
              IQR = {currentStats.iqr.toFixed(2)}
            </span>
          </Flexbox>
        </div>
      )}

      {/* Export */}
      <Flexbox gap={8} horizontal>
        <Button
          onClick={() => {
            navigator.clipboard.writeText(summaryText);
          }}
          size={'small'}
        >
          📋 Copy thống kê
        </Button>
        <Upload accept=".csv,.tsv,.txt" beforeUpload={handleFile} showUploadList={false}>
          <Button size={'small'}>📂 Upload file khác</Button>
        </Upload>
      </Flexbox>
    </Flexbox>
  );
});

DataAnalyzer.displayName = 'DataAnalyzer';
export default DataAnalyzer;
