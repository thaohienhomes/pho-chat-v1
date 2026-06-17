'use client';

/**
 * MED-42: Statistical Test Advisor
 * A branching decision-tree wizard that guides users to choose the right
 * statistical test based on: goal, data type, groups, distribution, pairing.
 *
 * Decision logic based on:
 * - Parametric vs non-parametric flow
 * - Common medical research scenarios (RCT, cohort, correlation, survival)
 */
import { Button, Tag } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, RotateCcw } from 'lucide-react';
import { memo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

// ── Types ─────────────────────────────────────────────────────────────────
type StepId =
  | 'goal'
  | 'outcome_type'
  | 'groups'
  | 'paired'
  | 'distribution'
  | 'correlation_type'
  | 'survival'
  | 'result';

interface Step {
  id: StepId;
  options: Option[];
  question: string;
  subtitle?: string;
}

interface Option {
  emoji?: string;
  label: string;
  next: StepId | 'result';
  value: string;
}

interface TestResult {
  alternatives?: string[];
  assumptions?: string[];
  color: string;
  description: string;
  emoji: string;
  formula?: string;
  interpretation: string;
  name: string;
  useCases: string[];
  whenToUse: string;
}

// ── Decision Tree ──────────────────────────────────────────────────────────
const STEPS: Record<StepId, Step> = {
  correlation_type: {
    id: 'correlation_type',
    options: [
      {
        emoji: '📏',
        label: "Cả 2 biến đều liên tục + phân phối chuẩn → Pearson's r",
        next: 'result',
        value: 'pearson',
      },
      {
        emoji: '�',
        label: 'Biến thứ tự hoặc không phân phối chuẩn → Spearman ρ',
        next: 'result',
        value: 'spearman',
      },
      {
        emoji: '✅',
        label: "Biến nhị phân / danh mục → Phi / Cramer's V / Chi-square",
        next: 'result',
        value: 'phi',
      },
    ],
    question: '🔗 Loại tương quan bạn muốn đo?',
  },
  distribution: {
    id: 'distribution',
    options: [
      {
        emoji: '�',
        label: 'Phân phối chuẩn (Normal) — đã kiểm tra Shapiro-Wilk',
        next: 'result',
        value: 'normal',
      },
      {
        emoji: '�',
        label: 'Không theo phân phối chuẩn (Non-normal / Skewed)',
        next: 'result',
        value: 'nonnormal',
      },
      { emoji: '❓', label: 'Chưa biết / Cỡ mẫu nhỏ (n < 30)', next: 'result', value: 'unknown' },
    ],
    question: '� Dữ liệu có phân phối chuẩn không?',
    subtitle: 'Kiểm tra bằng Shapiro-Wilk (Q-Q plot) hoặc Kolmogorov-Smirnov',
  },
  goal: {
    id: 'goal',
    options: [
      {
        emoji: '⚖️',
        label: 'So sánh trung bình / tỷ lệ giữa các nhóm',
        next: 'outcome_type',
        value: 'compare',
      },
      {
        emoji: '🔗',
        label: 'Tìm mối tương quan giữa 2 biến',
        next: 'correlation_type',
        value: 'correlate',
      },
      {
        emoji: '⏱️',
        label: 'Phân tích thời gian sống (Survival)',
        next: 'survival',
        value: 'survival',
      },
      { emoji: '📊', label: 'Dự đoán / Hồi quy (Predict)', next: 'outcome_type', value: 'predict' },
    ],
    question: '🎯 Mục tiêu phân tích của bạn là gì?',
    subtitle: 'Chọn loại câu hỏi nghiên cứu phù hợp nhất',
  },
  groups: {
    id: 'groups',
    options: [
      {
        emoji: '1️⃣',
        label: '1 nhóm (so sánh với giá trị chuẩn)',
        next: 'distribution',
        value: '1',
      },
      { emoji: '2️⃣', label: '2 nhóm', next: 'paired', value: '2' },
      { emoji: '3️⃣', label: '3+ nhóm', next: 'distribution', value: '3+' },
    ],
    question: '� Bạn có bao nhiêu nhóm so sánh?',
  },
  outcome_type: {
    id: 'outcome_type',
    options: [
      {
        emoji: '�',
        label: 'Liên tục / Định lượng (VD: huyết áp, BMI, nồng độ)',
        next: 'groups',
        value: 'continuous',
      },
      {
        emoji: '�',
        label: 'Thứ tự (Ordinal) — thang điểm, mức độ đau',
        next: 'groups',
        value: 'ordinal',
      },
      {
        emoji: '✅',
        label: 'Nhị phân / Danh mục (VD: khỏi / không khỏi)',
        next: 'groups',
        value: 'categorical',
      },
    ],
    question: '� Biến kết cục (Outcome) của bạn là loại nào?',
  },
  paired: {
    id: 'paired',
    options: [
      {
        emoji: '�',
        label: 'Có ghép cặp (Trước-Sau, Matched pairs)',
        next: 'distribution',
        value: 'paired',
      },
      {
        emoji: '🆚',
        label: 'Độc lập (2 nhóm riêng biệt)',
        next: 'distribution',
        value: 'independent',
      },
    ],
    question: '🔗 Hai nhóm có ghép cặp không?',
    subtitle: 'VD: đo trước/sau điều trị cùng bệnh nhân = ghép cặp',
  },
  result: { id: 'result', options: [], question: '' },
  survival: {
    id: 'survival',
    options: [
      {
        emoji: '📈',
        label: 'Mô tả đường cong sống sót → Kaplan-Meier',
        next: 'result',
        value: 'km',
      },
      { emoji: '⚖️', label: 'So sánh 2+ nhóm → Log-rank test', next: 'result', value: 'logrank' },
      {
        emoji: '🔢',
        label: 'Kiểm soát confounders → Cox Proportional Hazards',
        next: 'result',
        value: 'cox',
      },
    ],
    question: '⏱️ Bạn muốn làm gì với dữ liệu survival?',
  },
};

const RESULTS: Record<string, TestResult> = {
  anova: {
    alternatives: [
      'Welch ANOVA (nếu phương sai không đồng đều)',
      'Repeated Measures ANOVA (ghép cặp)',
    ],
    assumptions: [
      'Phân phối chuẩn trong mỗi nhóm',
      'Đồng nhất phương sai (Levene test)',
      'Độc lập giữa các quan sát',
    ],
    color: '#1677ff',
    description: 'So sánh trung bình 3+ nhóm độc lập, dữ liệu phân phối chuẩn.',
    emoji: '📊',
    formula: 'F = MS_between / MS_within',
    interpretation:
      'p < 0.05 → ít nhất 1 cặp nhóm khác biệt ý nghĩa. Dùng post-hoc Tukey/Bonferroni để xác định cặp nào.',
    name: 'ANOVA một chiều (One-way ANOVA)',
    useCases: ['So sánh hiệu quả 3+ liều thuốc', 'So sánh chỉ số lâm sàng giữa 3+ nhóm bệnh nhân'],
    whenToUse: '3+ nhóm · Dữ liệu liên tục · Phân phối chuẩn · Độc lập',
  },
  chisquare: {
    alternatives: [
      "Fisher's Exact (n nhỏ)",
      'McNemar (ghép cặp nhị phân)',
      "Cramer's V (đo lường hiệu ứng)",
    ],
    assumptions: [
      'Tần số kỳ vọng mỗi ô ≥ 5 (nếu không → Fisher Exact)',
      'Độc lập giữa các quan sát',
    ],
    color: '#722ed1',
    description: 'So sánh phân phối tần số giữa các nhóm đối với biến danh mục.',
    emoji: '✅',
    formula: 'χ² = Σ (O - E)² / E',
    interpretation:
      'p < 0.05 → tỉ lệ giữa các nhóm khác biệt ý nghĩa thống kê. Dùng RR hoặc OR để đo độ mạnh hiệu ứng.',
    name: 'Chi-square test (χ²)',
    useCases: ['So sánh tỉ lệ đáp ứng điều trị', 'Phân tích 2×2 contingency table'],
    whenToUse: 'Biến nhị phân / danh mục · Tần số kỳ vọng ≥ 5',
  },
  cox: {
    alternatives: ['Log-rank test (so sánh nhóm đơn giản)', 'Competing risks model (Fine-Gray)'],
    assumptions: [
      'Proportional hazards assumption (kiểm tra Schoenfeld residuals)',
      'Mỗi sự kiện độc lập',
    ],
    color: '#13c2c2',
    description: 'Mô hình hồi quy cho dữ liệu survival với kiểm soát nhiều biến.',
    emoji: '🔢',
    formula: 'h(t) = h₀(t) · exp(β₁X₁ + β₂X₂ + ...)',
    interpretation:
      'HR (Hazard Ratio): HR > 1 → tăng nguy cơ, HR < 1 → giảm nguy cơ. 95% CI không bao gồm 1.0 → ý nghĩa thống kê.',
    name: 'Cox Proportional Hazards',
    useCases: [
      'Phân tích yếu tố tiên lượng tử vong',
      'Điều chỉnh confounding trong nghiên cứu thuần tập',
    ],
    whenToUse: 'Survival data · Nhiều biến độc lập · Kiểm soát confounders',
  },
  independent_t: {
    alternatives: [
      'Mann-Whitney U (nếu dữ liệu không chuẩn)',
      'Welch t-test (phương sai không bằng nhau)',
    ],
    assumptions: [
      'Phân phối chuẩn trong mỗi nhóm',
      'Đồng nhất phương sai (Levene test)',
      'Độc lập giữa 2 nhóm',
    ],
    color: '#1677ff',
    description: 'So sánh trung bình 2 nhóm độc lập, dữ liệu phân phối chuẩn.',
    emoji: '⚖️',
    formula: 't = (X̄₁ - X̄₂) / √(sp² · (1/n₁ + 1/n₂))',
    interpretation:
      "p < 0.05 → trung bình 2 nhóm khác biệt ý nghĩa. Báo cáo Cohen's d để đo lường kích thước hiệu ứng.",
    name: 'Independent Samples t-test',
    useCases: [
      'So sánh huyết áp trung bình giữa nhóm điều trị và chứng',
      'So sánh BMI giữa nam và nữ',
    ],
    whenToUse: '2 nhóm độc lập · Biến liên tục · Phân phối chuẩn',
  },
  kaplan_meier: {
    alternatives: ['Log-rank test (so sánh giữa nhóm)', 'Restricted Mean Survival Time (RMST)'],
    assumptions: ['Censoring không phụ thuộc vào kết cục', 'Tỷ lệ rời nhóm (censoring) ngẫu nhiên'],
    color: '#52c41a',
    description: 'Ước tính và trực quan hóa xác suất sống sót theo thời gian.',
    emoji: '📈',
    formula: 'S(t) = Π (1 - dᵢ/nᵢ)',
    interpretation:
      'Đường cong KM hiển thị xác suất sống sót theo thời gian. Median survival time là thời điểm S(t) = 0.5.',
    name: 'Kaplan-Meier Estimator',
    useCases: ['Đường cong sống sót bệnh nhân ung thư', 'Thời gian đến biến cố tái phát'],
    whenToUse: 'Phân tích survival · Mô tả đơn nhóm hoặc đa nhóm',
  },
  kruskal: {
    alternatives: ['ANOVA (nếu phân phối chuẩn)', 'Jonckheere-Terpstra (xu hướng có thứ tự)'],
    assumptions: ['Độc lập giữa các quan sát', 'Dữ liệu ít nhất ordinal'],
    color: '#fa8c16',
    description: 'Phiên bản phi tham số của ANOVA, so sánh 3+ nhóm độc lập.',
    emoji: '📉',
    formula: 'H = (12/N(N+1)) · Σ(Rᵢ²/nᵢ) - 3(N+1)',
    interpretation:
      'p < 0.05 → ít nhất 1 nhóm khác biệt. Dùng post-hoc Dunn test với điều chỉnh Bonferroni.',
    name: 'Kruskal-Wallis Test',
    useCases: [
      'So sánh thang điểm đau giữa 3 nhóm điều trị',
      'So sánh biến không chuẩn giữa nhiều trung tâm',
    ],
    whenToUse: '3+ nhóm · Dữ liệu ordinal hoặc không phân phối chuẩn',
  },
  logrank: {
    alternatives: [
      'Breslow test (Wilcoxon — trọng số sự kiện sớm hơn)',
      'Cox regression (đa biến)',
    ],
    assumptions: ['Proportional hazards giữa các nhóm', 'Censoring ngẫu nhiên và không phụ thuộc'],
    color: '#eb2f96',
    description: 'So sánh đường cong sống sót giữa 2+ nhóm.',
    emoji: '⚖️',
    formula: 'χ² = (O - E)² / E (theo từng thời điểm kiện)',
    interpretation:
      'p < 0.05 → đường cong sống sót 2 nhóm khác biệt ý nghĩa. Báo cáo HR và 95% CI.',
    name: 'Log-rank Test',
    useCases: [
      'So sánh thời gian sống giữa nhóm phẫu thuật và hoá trị',
      'Phân tích Kaplan-Meier đa nhóm',
    ],
    whenToUse: 'Survival data · So sánh 2+ đường cong',
  },
  mann_whitney: {
    alternatives: [
      'Independent t-test (nếu phân phối chuẩn)',
      'Brunner-Munzel test (phương sai rất khác nhau)',
    ],
    assumptions: ['Hai nhóm độc lập', 'Dữ liệu ít nhất ordinal'],
    color: '#fa8c16',
    description: 'Phiên bản phi tham số của independent t-test, so sánh rank giữa 2 nhóm.',
    emoji: '📉',
    formula: 'U = n₁n₂ + n₁(n₁+1)/2 - ΣR₁',
    interpretation:
      'p < 0.05 → phân phối 2 nhóm khác biệt ý nghĩa. Báo cáo rank-biserial correlation r = Z/√N làm effect size.',
    name: 'Mann-Whitney U Test',
    useCases: [
      'So sánh thang điểm đau giữa 2 nhóm khi phân phối lệch',
      'So sánh giá trị enzyme giữa 2 nhóm bệnh',
    ],
    whenToUse: '2 nhóm độc lập · Dữ liệu không theo phân phối chuẩn',
  },
  one_sample_t: {
    alternatives: ['Wilcoxon signed-rank (nếu không chuẩn)'],
    assumptions: ['Phân phối chuẩn', 'Cỡ mẫu n ≥ 30 (CLT) hoặc Shapiro-Wilk p > 0.05'],
    color: '#1677ff',
    description: 'Kiểm tra trung bình mẫu có khác với 1 giá trị chuẩn nhất định không.',
    emoji: '1️⃣',
    formula: 't = (X̄ - μ₀) / (s / √n)',
    interpretation:
      "p < 0.05 → trung bình mẫu khác biệt ý nghĩa với giá trị μ₀. Báo cáo 95% CI và Cohen's d.",
    name: 'One-sample t-test',
    useCases: [
      'Kiểm tra BMI trung bình có bằng 25 không',
      'So sánh nồng độ đường huyết với ngưỡng chuẩn',
    ],
    whenToUse: '1 nhóm · So sánh với giá trị chuẩn · Phân phối chuẩn',
  },
  paired_t: {
    alternatives: ['Wilcoxon signed-rank test (nếu không chuẩn)'],
    assumptions: ['Sự khác biệt (difference) phân phối chuẩn', 'Các cặp quan sát độc lập với nhau'],
    color: '#1677ff',
    description: 'So sánh trung bình trước và sau can thiệp trên cùng đối tượng.',
    emoji: '🔄',
    formula: 't = d̄ / (sd / √n)',
    interpretation:
      "p < 0.05 → có sự thay đổi ý nghĩa trước-sau. Cohen's d = d̄/sd để đo effect size.",
    name: 'Paired t-test (t-test ghép cặp)',
    useCases: [
      'So sánh huyết áp trước và sau dùng thuốc',
      'So sánh cân nặng trước-sau chương trình giảm cân',
    ],
    whenToUse: '2 phép đo ghép cặp · Biến liên tục · Phân phối chuẩn',
  },
  pearson: {
    alternatives: [
      'Spearman ρ (nếu không chuẩn hoặc outliers)',
      'Partial correlation (kiểm soát confounders)',
    ],
    assumptions: ['Cả 2 biến phân phối chuẩn', 'Quan hệ tuyến tính', 'Không có outliers cực đoan'],
    color: '#13c2c2',
    description: 'Đo lường mức độ tương quan tuyến tính giữa 2 biến định lượng.',
    emoji: '📏',
    formula: 'r = Σ(xᵢ - x̄)(yᵢ - ȳ) / √[Σ(xᵢ-x̄)² · Σ(yᵢ-ȳ)²]',
    interpretation:
      'r: 0.1=yếu, 0.3=trung bình, 0.5=mạnh. r² = tỉ lệ biến thiên giải thích được. p < 0.05 → tương quan ý nghĩa.',
    name: "Pearson's Correlation (r)",
    useCases: ['Tương quan giữa BMI và huyết áp', 'Tương quan giữa tuổi và cholesterol'],
    whenToUse: '2 biến liên tục · Phân phối chuẩn · Quan hệ tuyến tính',
  },
  spearman: {
    alternatives: ["Pearson's r (nếu đủ điều kiện)", "Kendall's τ (cỡ mẫu nhỏ)"],
    assumptions: ['Quan hệ đơn điệu (monotonic)', 'Không yêu cầu phân phối chuẩn'],
    color: '#fa8c16',
    description: 'Đo lường tương quan thứ hạng giữa 2 biến (phi tham số).',
    emoji: '📊',
    formula: 'ρ = 1 - 6Σd²ᵢ / (n(n²-1))',
    interpretation: "ρ có miền [-1, 1]. Diễn giải tương tự Pearson's r nhưng dựa trên rank.",
    name: "Spearman's Rank Correlation (ρ)",
    useCases: [
      'Tương quan giữa thang điểm đau và chất lượng cuộc sống',
      'Tương quan biến lệnh chuẩn với kết quả lâm sàng',
    ],
    whenToUse: 'Biến ordinal hoặc liên tục không chuẩn · Quan hệ đơn điệu',
  },
  wilcoxon: {
    alternatives: ['Paired t-test (nếu phân phối chuẩn)', 'Sign test (cỡ mẫu rất nhỏ)'],
    assumptions: ['Phân phối của sự khác biệt đối xứng quanh median', 'Dữ liệu ít nhất ordinal'],
    color: '#fa8c16',
    description: 'Phiên bản phi tham số của paired t-test, so sánh trước-sau không chuẩn.',
    emoji: '🔄',
    formula: 'W = ΣR⁺ (tổng các rank dương)',
    interpretation: 'p < 0.05 → sự thay đổi trước-sau ý nghĩa. r = Z/√N là effect size.',
    name: 'Wilcoxon Signed-Rank Test',
    useCases: [
      'So sánh mức đau trước-sau điều trị khi phân phối lệch',
      'Đánh giá thay đổi thang điểm lâm sàng',
    ],
    whenToUse: '2 phép đo ghép cặp · Không phân phối chuẩn',
  },
  wilcoxon_1: {
    alternatives: ['One-sample t-test (nếu phân phối chuẩn)', 'Sign test (đơn giản hơn)'],
    assumptions: ['Phân phối đối xứng quanh median', 'Dữ liệu ít nhất ordinal'],
    color: '#fa8c16',
    description: 'So sánh median của 1 mẫu với giá trị chuẩn nhất định (phi tham số).',
    emoji: '1️⃣',
    formula: 'W = ΣR⁺ (các rank dương so với μ₀)',
    interpretation: 'p < 0.05 → median mẫu khác biệt ý nghĩa với giá trị chuẩn.',
    name: 'Wilcoxon Signed-Rank (1 mẫu)',
    useCases: [
      'Kiểm tra median đau có khác 5/10 không',
      'Kiểm tra chỉ số lâm sàng so với ngưỡng tham chiếu',
    ],
    whenToUse: '1 nhóm · So sánh với giá trị chuẩn · Không phân phối chuẩn',
  },
};

// ── Test Result Logic ──────────────────────────────────────────────────────
const resolveResult = (answers: Record<StepId, string>): TestResult => {
  const g = answers.goal;
  const ot = answers.outcome_type;
  const grp = answers.groups;
  const paired = answers.paired;
  const dist = answers.distribution;
  const corrType = answers.correlation_type;
  const surv = answers.survival;

  // Correlation branch
  if (g === 'correlate') {
    if (corrType === 'pearson') return RESULTS.pearson;
    if (corrType === 'spearman') return RESULTS.spearman;
    return RESULTS.chisquare;
  }
  // Survival branch
  if (g === 'survival') {
    if (surv === 'km') return RESULTS.kaplan_meier;
    if (surv === 'logrank') return RESULTS.logrank;
    return RESULTS.cox;
  }
  // Categorical outcome
  if (ot === 'categorical') return RESULTS.chisquare;
  // Ordinal outcome
  if (ot === 'ordinal') {
    if (grp === '1') return RESULTS.wilcoxon_1;
    if (grp === '2' && paired === 'paired') return RESULTS.wilcoxon;
    if (grp === '2') return RESULTS.mann_whitney;
    return RESULTS.kruskal;
  }
  // Continuous outcome
  const isNormal = dist === 'normal';
  if (grp === '1') return isNormal ? RESULTS.one_sample_t : RESULTS.wilcoxon_1;
  if (grp === '2') {
    if (paired === 'paired') return isNormal ? RESULTS.paired_t : RESULTS.wilcoxon;
    return isNormal ? RESULTS.independent_t : RESULTS.mann_whitney;
  }
  return isNormal ? RESULTS.anova : RESULTS.kruskal;
};

// ── Styles ─────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  assumption: css`
    display: flex;
    gap: 6px;
    align-items: flex-start;

    font-size: 12px;
    color: ${token.colorTextSecondary};

    &::before {
      content: '•';
      flex-shrink: 0;
      color: ${token.colorPrimary};
    }
  `,
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
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    padding-block: 10px;
    padding-inline: 14px;
    border: 1.5px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    font-size: 13px;
    text-align: start;

    background: ${token.colorBgContainer};

    transition: all 0.15s ease;

    &:hover {
      transform: translateX(2px);
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  progressDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: ${token.colorFillSecondary};

    transition: background 0.2s;

    &.active {
      background: ${token.colorPrimary};
    }

    &.done {
      background: ${token.colorSuccess};
    }
  `,
  question: css`
    font-size: 15px;
    font-weight: 700;
    line-height: 1.4;
    color: ${token.colorText};
  `,
  resultHeader: css`
    padding: 20px;
    border: 2px solid;
    border-radius: ${token.borderRadiusLG}px;
  `,
  sectionTitle: css`
    margin-block-end: 6px;

    font-size: 12px;
    font-weight: 700;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
  subtitle: css`
    margin-block-start: 4px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
}));

// ── History display names ──────────────────────────────────────────────────
const STEP_LABELS: Partial<Record<StepId, string>> = {
  distribution: 'Phân phối',
  goal: 'Mục tiêu',
  groups: 'Số nhóm',
  outcome_type: 'Loại biến',
  paired: 'Ghép cặp',
};

const OPTION_LABELS: Record<string, string> = {
  '1': '1 nhóm',
  '2': '2 nhóm',
  '3+': '3+ nhóm',
  'categorical': 'Danh mục/Nhị phân',
  'compare': 'So sánh',
  'continuous': 'Liên tục',
  'correlate': 'Tương quan',
  'cox': 'Cox Hazards',
  'independent': 'Độc lập',
  'km': 'Kaplan-Meier',
  'logrank': 'Log-rank',
  'nonnormal': 'Không chuẩn',
  'normal': 'Phân phối chuẩn',
  'ordinal': 'Thứ tự',
  'paired': 'Ghép cặp',
  'pearson': 'Pearson r',
  'phi': 'Phi/Chi-square',
  'predict': 'Dự đoán/Hồi quy',
  'spearman': 'Spearman ρ',
  'survival': 'Survival',
  'unknown': 'Chưa biết',
};

// ── Component ──────────────────────────────────────────────────────────────
const StatTestAdvisor = memo(() => {
  const { styles } = useStyles();

  const [currentStep, setCurrentStep] = useState<StepId>('goal');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<StepId[]>([]);
  const [result, setResult] = useState<TestResult | null>(null);

  const step = STEPS[currentStep];

  const handleOption = (opt: Option) => {
    const newAnswers = { ...answers, [currentStep]: opt.value };
    setAnswers(newAnswers);
    setHistory((h) => [...h, currentStep]);

    if (opt.next === 'result') {
      setResult(resolveResult(newAnswers as Record<StepId, string>));
      setCurrentStep('result');
    } else {
      setCurrentStep(opt.next as StepId);
    }
  };

  const handleBack = () => {
    if (history.length === 0) return;
    const prev = history.at(-1)!;
    setHistory((h) => h.slice(0, -1));
    setCurrentStep(prev);
    setResult(null);
    const newAns = { ...answers };
    delete newAns[prev];
    setAnswers(newAns);
  };

  const handleReset = () => {
    setCurrentStep('goal');
    setAnswers({});
    setHistory([]);
    setResult(null);
  };

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={10} horizontal justify={'space-between'}>
        <Flexbox align={'center'} gap={8} horizontal>
          {history.length > 0 && !result && (
            <button
              onClick={handleBack}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              type="button"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <span style={{ fontSize: 14, fontWeight: 700 }}>🧮 Tư vấn Kiểm định Thống kê</span>
        </Flexbox>
        {history.length > 0 && (
          <button
            onClick={handleReset}
            style={{
              alignItems: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              gap: 4,
              opacity: 0.6,
              padding: 4,
            }}
            type="button"
          >
            <RotateCcw size={12} /> <span style={{ fontSize: 11 }}>Làm lại</span>
          </button>
        )}
      </Flexbox>

      {/* Progress breadcrumb */}
      {Object.keys(answers).length > 0 && (
        <Flexbox gap={4} horizontal wrap={'wrap'}>
          {Object.entries(answers)
            .filter(([k]) => STEP_LABELS[k as StepId])
            .map(([k, v]) => (
              <span
                key={k}
                style={{
                  background: 'rgba(99,226,183,0.1)',
                  border: '1px solid rgba(99,226,183,0.3)',
                  borderRadius: 12,
                  fontSize: 11,
                  padding: '2px 8px',
                }}
              >
                {STEP_LABELS[k as StepId]}: <b>{OPTION_LABELS[v] ?? v}</b>
              </span>
            ))}
        </Flexbox>
      )}

      {/* Question step */}
      {!result && step && (
        <Flexbox className={styles.card} gap={14}>
          <div>
            <p className={styles.question}>{step.question}</p>
            {step.subtitle && <p className={styles.subtitle}>{step.subtitle}</p>}
          </div>
          <Flexbox gap={8}>
            {step.options.map((opt) => (
              <button
                className={styles.option}
                key={opt.value}
                onClick={() => handleOption(opt)}
                type="button"
              >
                <span>
                  {opt.emoji && <span style={{ marginRight: 8 }}>{opt.emoji}</span>}
                  {opt.label}
                </span>
                <ChevronRight opacity={0.4} size={14} />
              </button>
            ))}
          </Flexbox>
        </Flexbox>
      )}

      {/* Result card */}
      {result && (
        <Flexbox gap={16}>
          {/* Test name card */}
          <div
            className={styles.resultHeader}
            style={{ background: result.color + '10', borderColor: result.color + '40' }}
          >
            <Flexbox align={'flex-start'} gap={10} horizontal>
              <span style={{ fontSize: 32 }}>{result.emoji}</span>
              <Flexbox gap={4}>
                <div style={{ color: result.color, fontSize: 16, fontWeight: 800 }}>
                  {result.name}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{result.description}</div>
                <Tag
                  bordered={false}
                  style={{
                    background: result.color + '20',
                    color: result.color,
                    fontSize: 11,
                    marginTop: 4,
                    width: 'fit-content',
                  }}
                >
                  <CheckCircle2 size={10} style={{ marginRight: 4 }} />
                  {result.whenToUse}
                </Tag>
              </Flexbox>
            </Flexbox>
          </div>

          {/* Formula */}
          {result.formula && (
            <div className={styles.card}>
              <p className={styles.sectionTitle}>📐 Công thức</p>
              <code
                style={{
                  background: 'rgba(99,226,183,0.08)',
                  border: '1px solid rgba(99,226,183,0.2)',
                  borderRadius: 6,
                  display: 'block',
                  fontFamily: 'monospace',
                  fontSize: 13,
                  padding: '8px 12px',
                }}
              >
                {result.formula}
              </code>
            </div>
          )}

          {/* Interpretation */}
          <div className={styles.card}>
            <p className={styles.sectionTitle}>📖 Diễn giải kết quả</p>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>{result.interpretation}</p>
          </div>

          {/* Use cases + Assumptions side-by-side */}
          <Flexbox gap={12} horizontal wrap={'wrap'}>
            <Flexbox className={styles.card} flex={1} gap={6} style={{ minWidth: 200 }}>
              <p className={styles.sectionTitle}>🏥 Ứng dụng lâm sàng</p>
              {result.useCases.map((uc) => (
                <div className={styles.assumption} key={uc}>
                  {uc}
                </div>
              ))}
            </Flexbox>
            <Flexbox className={styles.card} flex={1} gap={6} style={{ minWidth: 200 }}>
              <p className={styles.sectionTitle}>⚠️ Điều kiện áp dụng</p>
              {result.assumptions?.map((a) => (
                <div className={styles.assumption} key={a}>
                  {a}
                </div>
              ))}
            </Flexbox>
          </Flexbox>

          {/* Alternatives */}
          {result.alternatives && (
            <div className={styles.card}>
              <p className={styles.sectionTitle}>🔄 Phương án thay thế</p>
              <Flexbox gap={6} horizontal wrap={'wrap'}>
                {result.alternatives.map((alt) => (
                  <Tag bordered key={alt} style={{ fontSize: 11 }}>
                    <BookOpen size={10} style={{ marginRight: 4 }} />
                    {alt}
                  </Tag>
                ))}
              </Flexbox>
            </div>
          )}

          {/* Actions */}
          <Flexbox gap={8} horizontal>
            <Button onClick={handleReset} size={'small'}>
              🔄 Kiểm tra lại
            </Button>
            <Button
              onClick={() => {
                const text = `Kiểm định được gợi ý: ${result.name}\n\nDiễn giải: ${result.interpretation}\n\nĐiều kiện: ${result.assumptions?.join(', ')}\n\nCông thức: ${result.formula}`;
                navigator.clipboard.writeText(text);
              }}
              size={'small'}
            >
              📋 Copy kết quả
            </Button>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

StatTestAdvisor.displayName = 'StatTestAdvisor';
export default StatTestAdvisor;
