'use client';

import { Button } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Download } from 'lucide-react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useResearchStore } from '@/store/research';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100%;
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};
  `,
  header: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
  svgWrapper: css`
    overflow-x: auto;
    width: 100%;

    svg {
      max-width: 100%;
      height: auto;
    }
  `,
}));

// ── PRISMA layout constants ─────────────────────────────────
const W = 180; // box width
const H = 52; // box height
const GAP_X = 60; // horizontal gap between columns
const GAP_Y = 36; // vertical gap between rows
const COL1 = 20;
const COL2 = COL1 + W + GAP_X; // 260
const TOTAL_W = COL2 + W + 20; // 460

const BOX_R = 8; // corner radius

type BoxData = {
  color?: string;
  dashed?: boolean;
  id: string;
  label: string;
  value?: string | number;
  x: number;
  y: number;
};

const PrismaBox = ({ x, y, label, value, color = '#1677ff', dashed = false }: BoxData) => (
  <g>
    <rect
      fill={color === 'red' ? '#fff1f0' : color === 'green' ? '#f6ffed' : '#f0f5ff'}
      height={H}
      rx={BOX_R}
      stroke={color === 'red' ? '#ff4d4f' : color === 'green' ? '#52c41a' : '#4096ff'}
      strokeDasharray={dashed ? '5,3' : undefined}
      strokeWidth={1.5}
      width={W}
      x={x}
      y={y}
    />
    <text
      dominantBaseline="middle"
      fill={color === 'red' ? '#cf1322' : color === 'green' ? '#389e0d' : '#1677ff'}
      fontSize={10.5}
      fontWeight={600}
      textAnchor="middle"
      x={x + W / 2}
      y={y + (value !== undefined ? H / 3 : H / 2)}
    >
      {label}
    </text>
    {value !== undefined && (
      <text
        dominantBaseline="middle"
        fill="#555"
        fontSize={13}
        fontWeight={700}
        textAnchor="middle"
        x={x + W / 2}
        y={y + (H * 2) / 3}
      >
        n = {value}
      </text>
    )}
  </g>
);

const Arrow = ({ x1, y1, x2, y2 }: { x1: number; x2: number; y1: number; y2: number }) => (
  <line
    markerEnd="url(#arrowhead)"
    stroke="#888"
    strokeWidth={1.5}
    x1={x1}
    x2={x2}
    y1={y1}
    y2={y2}
  />
);

const SectionLabel = ({ x, y, text }: { text: string; x: number; y: number }) => (
  <g>
    <rect fill="#e6f4ff" height={22} rx={4} width={90} x={x} y={y - 11} />
    <text
      dominantBaseline="middle"
      fill="#0958d9"
      fontSize={9}
      fontWeight={700}
      textAnchor="middle"
      x={x + 45}
      y={y}
    >
      {text}
    </text>
  </g>
);

// ── Main Component ───────────────────────────────────────────
const PrismaDiagram = memo(() => {
  const { styles } = useStyles();
  const svgRef = useRef<SVGSVGElement>(null);

  const papers = useResearchStore((s) => s.papers);
  const screeningDecisions = useResearchStore((s) => s.screeningDecisions);
  const searchQuery = useResearchStore((s) => s.searchQuery);

  // ── Compute stats ─────────────────────────────────────────
  const stats = useMemo(() => {
    const total = papers.length;
    const decisioned = Object.values(screeningDecisions);
    const included = decisioned.filter((d) => d.decision === 'included').length;
    const excluded = decisioned.filter((d) => d.decision === 'excluded').length;
    const pending = total - decisioned.length;

    // Exclusion reasons breakdown
    const reasonMap: Record<string, number> = {};
    for (const d of decisioned) {
      if (d.decision === 'excluded' && d.reason) {
        reasonMap[d.reason] = (reasonMap[d.reason] ?? 0) + 1;
      }
    }

    // Source breakdown
    const sourceMap: Record<string, number> = {};
    for (const p of papers) {
      sourceMap[p.source] = (sourceMap[p.source] ?? 0) + 1;
    }

    return { excluded, included, pending, reasonMap, sourceMap, total };
  }, [papers, screeningDecisions]);

  // ── SVG layout ────────────────────────────────────────────
  const ROW = (n: number) => 30 + n * (H + GAP_Y);

  // Section Y offsets
  const Y_IDENTIFY = ROW(0);
  const Y_SCREEN = ROW(2.2);
  const Y_ELIGIBLE = ROW(4.4);
  const Y_INCLUDED = ROW(6.6);
  const TOTAL_H = Y_INCLUDED + H + 30;

  // ── Export as SVG ─────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PRISMA_${searchQuery.slice(0, 30).replaceAll(' ', '_') || 'diagram'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [searchQuery]);

  return (
    <Flexbox className={styles.container} gap={12}>
      <Flexbox align={'center'} horizontal justify={'space-between'}>
        <span className={styles.header}>📊 Sơ đồ PRISMA 2020</span>
        <Button icon={<Download size={13} />} onClick={handleExport} size={'small'}>
          Xuất SVG
        </Button>
      </Flexbox>

      <div className={styles.svgWrapper}>
        <svg
          fontFamily="system-ui, -apple-system, sans-serif"
          height={TOTAL_H}
          ref={svgRef}
          viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
          width={TOTAL_W}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Arrow marker */}
          <defs>
            <marker
              id="arrowhead"
              markerHeight={7}
              markerWidth={10}
              orient="auto"
              refX={9}
              refY={3.5}
            >
              <polygon fill="#888" points="0 0, 10 3.5, 0 7" />
            </marker>
          </defs>

          {/* ── SECTION LABELS ── */}
          <SectionLabel text="NHẬN DIỆN" x={-5} y={Y_IDENTIFY + H / 2} />
          <SectionLabel text="SÀNG LỌC" x={-5} y={Y_SCREEN + H / 2} />
          <SectionLabel text="TIÊU CHUẨN" x={-5} y={Y_ELIGIBLE + H / 2} />
          <SectionLabel text="ĐƯA VÀO" x={-5} y={Y_INCLUDED + H / 2} />

          {/* ── ROW 0 — IDENTIFICATION ── */}
          <PrismaBox
            id="db"
            label="Hồ sơ từ cơ sở dữ liệu"
            value={stats.total}
            x={COL1}
            y={Y_IDENTIFY}
          />
          {/* Source breakdown as small chips */}
          {Object.entries(stats.sourceMap).map(([src, n], i) => (
            <g key={src}>
              <rect
                fill="#e6f4ff"
                height={16}
                rx={4}
                width={W}
                x={COL1}
                y={Y_IDENTIFY + H + 6 + i * 20}
              />
              <text
                dominantBaseline="middle"
                fill="#555"
                fontSize={9}
                textAnchor="middle"
                x={COL1 + W / 2}
                y={Y_IDENTIFY + H + 6 + i * 20 + 8}
              >
                {src}: n={n}
              </text>
            </g>
          ))}

          {/* Arrow: identification → screening */}
          <Arrow x1={COL1 + W / 2} x2={COL2 + W / 2} y1={Y_SCREEN - 8} y2={Y_SCREEN} />
          {/* Actually: col1 down */}
          <Arrow x1={COL1 + W / 2} x2={COL1 + W / 2} y1={Y_IDENTIFY + H} y2={Y_SCREEN} />

          {/* ── ROW 1 — SCREENING ── */}
          <PrismaBox
            id="screened"
            label="Hồ sơ được sàng lọc"
            value={stats.total}
            x={COL1}
            y={Y_SCREEN}
          />
          <PrismaBox
            color="red"
            id="excl-screen"
            label="Loại trước sàng lọc"
            value={0}
            x={COL2}
            y={Y_SCREEN}
          />
          {/* right arrow from screened to excluded */}
          <Arrow x1={COL1 + W} x2={COL2} y1={Y_SCREEN + H / 2} y2={Y_SCREEN + H / 2} />
          {/* down arrow */}
          <Arrow x1={COL1 + W / 2} x2={COL1 + W / 2} y1={Y_SCREEN + H} y2={Y_ELIGIBLE} />

          {/* ── ROW 2 — ELIGIBILITY ── */}
          <PrismaBox
            id="eligible"
            label="Đánh giá đủ tiêu chuẩn"
            value={stats.total - stats.excluded}
            x={COL1}
            y={Y_ELIGIBLE}
          />
          <PrismaBox
            color="red"
            id="excl-full"
            label={`Loại sau đọc toàn văn`}
            value={stats.excluded}
            x={COL2}
            y={Y_ELIGIBLE}
          />
          {/* Reason breakdown below exclusion box */}
          {Object.entries(stats.reasonMap)
            .slice(0, 4)
            .map(([reason, n], i) => (
              <g key={reason}>
                <rect
                  fill="#fff1f0"
                  height={16}
                  rx={3}
                  width={W}
                  x={COL2}
                  y={Y_ELIGIBLE + H + 4 + i * 18}
                />
                <text
                  dominantBaseline="middle"
                  fill="#cf1322"
                  fontSize={8.5}
                  textAnchor="middle"
                  x={COL2 + W / 2}
                  y={Y_ELIGIBLE + H + 4 + i * 18 + 8}
                >
                  {reason.length > 28 ? reason.slice(0, 28) + '…' : reason}: {n}
                </text>
              </g>
            ))}

          <Arrow x1={COL1 + W} x2={COL2} y1={Y_ELIGIBLE + H / 2} y2={Y_ELIGIBLE + H / 2} />
          <Arrow x1={COL1 + W / 2} x2={COL1 + W / 2} y1={Y_ELIGIBLE + H} y2={Y_INCLUDED} />

          {/* ── ROW 3 — INCLUDED ── */}
          <PrismaBox
            color="green"
            id="included"
            label="Đưa vào tổng quan"
            value={stats.included || stats.total - stats.excluded}
            x={COL1}
            y={Y_INCLUDED}
          />

          {/* Pending note */}
          {stats.pending > 0 && (
            <g>
              <rect
                fill="#fffbe6"
                height={H * 0.7}
                rx={BOX_R}
                stroke="#faad14"
                strokeDasharray="5,3"
                strokeWidth={1}
                width={W}
                x={COL2}
                y={Y_INCLUDED}
              />
              <text
                dominantBaseline="middle"
                fill="#d48806"
                fontSize={10}
                textAnchor="middle"
                x={COL2 + W / 2}
                y={Y_INCLUDED + H * 0.35}
              >
                Chờ quyết định: {stats.pending}
              </text>
            </g>
          )}

          {/* Bottom note */}
          <text fill="#aaa" fontSize={8} textAnchor="middle" x={TOTAL_W / 2} y={TOTAL_H - 8}>
            Phương pháp PRISMA 2020 · Tạo bởi Phở Chat Research Mode
          </text>
        </svg>
      </div>

      {/* Stats summary */}
      <Flexbox gap={6} horizontal wrap={'wrap'}>
        {[
          { color: '#1677ff', label: 'Tổng hồ sơ', value: stats.total },
          { color: '#52c41a', label: 'Đưa vào', value: stats.included },
          { color: '#ff4d4f', label: 'Loại trừ', value: stats.excluded },
          { color: '#faad14', label: 'Chờ xử lý', value: stats.pending },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              background: item.color + '15',
              border: `1px solid ${item.color}40`,
              borderRadius: 8,
              fontSize: 12,
              padding: '4px 12px',
              textAlign: 'center',
            }}
          >
            <div style={{ color: item.color, fontSize: 16, fontWeight: 700 }}>{item.value}</div>
            <div style={{ opacity: 0.7 }}>{item.label}</div>
          </div>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

PrismaDiagram.displayName = 'PrismaDiagram';
export default PrismaDiagram;
