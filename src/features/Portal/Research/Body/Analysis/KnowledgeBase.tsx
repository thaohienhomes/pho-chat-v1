'use client';

/**
 * MED-46: Biostatistics Knowledge Base
 *
 * Searchable encyclopedia of biostatistics concepts for medical students.
 * Features:
 * 1. Full-text search across all entries
 * 2. Category filtering
 * 3. Expandable entries with formula, explanation, example, and tips
 * 4. Bookmark favorites (persisted in state)
 * 5. Designed for future RAG integration (ErikKusch course content)
 *
 * ~30 entries covering core biostatistics topics in Vietnamese.
 */
import { Tag } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { BookMarked, BookOpen, ChevronDown, ChevronUp, Search, Star } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

// ── Types ──────────────────────────────────────────────────────────────────
interface KBEntry {
  category: string;
  example: string;
  formula?: string;
  id: string;
  keywords: string[];
  related: string[];
  summary: string;
  tips: string;
  title: string;
}

// ── Knowledge Base ─────────────────────────────────────────────────────────
const KB_ENTRIES: KBEntry[] = [
  {
    category: 'Mô tả',
    example:
      'BMI trung bình của 50 bệnh nhân: X̄ = 24.3 kg/m². Khi có outlier BMI = 55, mean bị kéo lên 25.8.',
    formula: 'X̄ = ΣXᵢ / n',
    id: 'mean',
    keywords: ['mean', 'trung bình', 'average', 'xu hướng trung tâm'],
    related: ['median', 'sd'],
    summary:
      'Trung bình cộng — tổng các giá trị chia cho số quan sát. Là đại lượng mô tả xu hướng trung tâm phổ biến nhất nhưng nhạy cảm với outliers.',
    tips: 'Khi dữ liệu lệch (skewed), dùng median thay cho mean. Luôn báo cáo kèm SD hoặc 95% CI.',
    title: 'Mean (Trung bình)',
  },
  {
    category: 'Mô tả',
    example:
      'Dữ liệu: 2, 4, 5, 8, 100. Mean = 23.8, Median = 5. Median phản ánh đúng hơn xu hướng trung tâm.',
    id: 'median',
    keywords: ['median', 'trung vị', 'percentile', 'phân vị'],
    related: ['mean', 'iqr'],
    summary:
      'Giá trị ở vị trí giữa khi sắp xếp dữ liệu. Không bị ảnh hưởng bởi outliers, phù hợp cho dữ liệu lệch.',
    tips: 'Báo cáo Median cùng IQR (Q1-Q3) cho dữ liệu không chuẩn. Dùng Median cho thời gian nằm viện, chi phí y tế.',
    title: 'Median (Trung vị)',
  },
  {
    category: 'Mô tả',
    example:
      'Huyết áp: Mean = 130 mmHg, SD = 15 mmHg. 68% bệnh nhân có HA 115-145, 95% có HA 100-160.',
    formula: 's = √[Σ(Xᵢ - X̄)² / (n-1)]',
    id: 'sd',
    keywords: ['standard deviation', 'độ lệch chuẩn', 'variance', 'phương sai', 'sd'],
    related: ['mean', 'se'],
    summary:
      'Đo mức độ phân tán của dữ liệu quanh mean. SD nhỏ → dữ liệu tập trung. SD lớn → dữ liệu phân tán.',
    tips: 'SD mô tả tính biến thiên của DỮ LIỆU. SE mô tả độ chính xác của ƯỚC TÍNH mean. Đừng nhầm lẫn!',
    title: 'Standard Deviation (Độ lệch chuẩn)',
  },
  {
    category: 'Mô tả',
    example: 'IQR = Q3 - Q1 = 78 - 55 = 23. 50% bệnh nhân có giá trị nằm trong khoảng 55-78.',
    id: 'iqr',
    keywords: ['iqr', 'interquartile range', 'khoảng tứ phân vị', 'quartile'],
    related: ['median', 'boxplot'],
    summary:
      'Khoảng từ phân vị 25% đến 75%, chứa 50% dữ liệu ở giữa. Dùng kết hợp median khi dữ liệu lệch.',
    tips: 'Outlier = giá trị nằm ngoài Q1 - 1.5×IQR hoặc Q3 + 1.5×IQR. Box plot trực quan hóa IQR rất hiệu quả.',
    title: 'IQR (Khoảng tứ phân vị)',
  },
  {
    category: 'Suy luận',
    example:
      'p = 0.03: nếu thuốc KHÔNG có hiệu quả (H₀ đúng), chỉ 3% xác suất quan sát khác biệt cực đoan như vậy.',
    id: 'pvalue',
    keywords: ['p-value', 'p value', 'ý nghĩa thống kê', 'significance', 'giá trị p'],
    related: ['ci', 'error_type1'],
    summary:
      'Xác suất quan sát kết quả cực đoan như (hoặc hơn) kết quả hiện tại, giả sử H₀ đúng. p < α → bác bỏ H₀.',
    tips: 'P-value KHÔNG phải xác suất H₀ đúng! P nhỏ chưa chắc có ý nghĩa lâm sàng. Luôn đánh giá effect size kèm p.',
    title: 'P-value',
  },
  {
    category: 'Suy luận',
    example:
      '95% CI cho OR: 1.5 (1.1 – 2.0). Vì CI không chứa 1.0 → OR có ý nghĩa thống kê ở mức α = 0.05.',
    formula: 'CI = X̄ ± Zα/2 × SE',
    id: 'ci',
    keywords: ['confidence interval', 'khoảng tin cậy', 'ci', '95%'],
    related: ['pvalue', 'se'],
    summary:
      'Khoảng ước tính chứa giá trị thật với xác suất nhất định (thường 95%). CI hẹp → ước tính chính xác hơn.',
    tips: 'CI chứa thông tin về cả độ lớn lẫn ý nghĩa. CI cho RR hoặc OR chứa 1.0 → không có ý nghĩa thống kê.',
    title: '95% Confidence Interval',
  },
  {
    category: 'Suy luận',
    example:
      'Kết luận thuốc có hiệu quả (p = 0.04) nhưng thực tế thuốc không hiệu quả → sai lầm loại I.',
    id: 'error_type1',
    keywords: ['type i error', 'sai lầm loại 1', 'alpha', 'dương tính giả', 'false positive'],
    related: ['error_type2', 'pvalue'],
    summary:
      'Bác bỏ H₀ khi H₀ đúng (dương tính giả). Xác suất = α, thường 0.05. Kiểm soát bằng cách đặt ngưỡng α.',
    tips: 'So sánh nhiều lần → tăng α tích lũy. Điều chỉnh Bonferroni: α_adj = α/k (k = số lần so sánh).',
    title: 'Type I Error (Sai lầm loại I)',
  },
  {
    category: 'Suy luận',
    example:
      'Nghiên cứu kết luận thuốc KHÔNG hiệu quả (p = 0.15) nhưng thực tế thuốc CÓ hiệu quả → sai lầm loại II.',
    id: 'error_type2',
    keywords: ['type ii error', 'sai lầm loại 2', 'beta', 'âm tính giả', 'false negative'],
    related: ['error_type1', 'power'],
    summary:
      'Không bác bỏ H₀ khi H₁ đúng (âm tính giả). Xác suất = β, thường 0.20. Giảm bằng cách tăng cỡ mẫu.',
    tips: 'Type II error thường do cỡ mẫu quá nhỏ. Tính sample size trước nghiên cứu để đảm bảo power ≥ 80%.',
    title: 'Type II Error (Sai lầm loại II)',
  },
  {
    category: 'Suy luận',
    example: 'Power = 80%, n = 64/nhóm để phát hiện effect size d = 0.5 với α = 0.05.',
    formula: 'Power = 1 - β',
    id: 'power',
    keywords: ['power', 'lực thống kê', 'sample size', 'cỡ mẫu'],
    related: ['error_type2', 'effect_size'],
    summary:
      'Xác suất bác bỏ H₀ khi H₁ đúng. Power ≥ 80% được coi là đủ. Phụ thuộc: n, effect size, α.',
    tips: 'Tăng power bằng: 1) tăng n, 2) tăng effect size, 3) tăng α, 4) giảm variability. Tính power TRƯỚC nghiên cứu.',
    title: 'Power (Lực thống kê)',
  },
  {
    category: 'Suy luận',
    example: 'Cohen d = 0.2 (nhỏ), d = 0.5 (trung bình), d = 0.8 (lớn). d = (X̄₁ - X̄₂) / SD_pooled.',
    id: 'effect_size',
    keywords: ['effect size', 'kích thước hiệu ứng', 'cohen d', 'clinical significance'],
    related: ['power', 'pvalue'],
    summary:
      'Đo lường MỨC ĐỘ khác biệt, không phụ thuộc n. Quan trọng hơn p-value cho ý nghĩa lâm sàng.',
    tips: 'P nhỏ + effect size nhỏ = có ý nghĩa thống kê nhưng có thể KHÔNG có ý nghĩa lâm sàng. Luôn báo cáo cả hai.',
    title: 'Effect Size',
  },
  {
    category: 'Kiểm định',
    example:
      'So sánh HA trung bình nhóm thuốc A (n=30, X̄=125) vs giả dược (n=30, X̄=135): t = 2.5, p = 0.015.',
    formula: 't = (X̄₁ - X̄₂) / √(sp² × (1/n₁ + 1/n₂))',
    id: 'ttest_ind',
    keywords: ['independent t-test', 't-test', 'so sánh 2 nhóm', 'student'],
    related: ['ttest_paired', 'mann_whitney'],
    summary:
      'So sánh trung bình 2 nhóm ĐỘC LẬP. Cần phân phối chuẩn và đồng phương sai (Levene test).',
    tips: 'Nếu phương sai không bằng → Welch t-test. Nếu không chuẩn → Mann-Whitney U. n < 30 → kiểm tra normality.',
    title: 'Independent t-test',
  },
  {
    category: 'Kiểm định',
    example: 'HA trước điều trị: 145, sau: 130. d̄ = -15, sd = 10, n = 25. t = -7.5, p < 0.001.',
    formula: 't = d̄ / (sd / √n)',
    id: 'ttest_paired',
    keywords: ['paired t-test', 't-test ghép cặp', 'trước sau', 'before after'],
    related: ['ttest_ind', 'wilcoxon'],
    summary:
      'So sánh trung bình trước-sau trên CÙNG đối tượng. Phép khác biệt (d) cần phân phối chuẩn.',
    tips: 'Kiểm tra normality của DIFFERENCE (d), không phải raw data. Nếu d không chuẩn → Wilcoxon signed-rank.',
    title: 'Paired t-test',
  },
  {
    category: 'Kiểm định',
    example:
      'So sánh 3 thuốc giảm đau: F(2,87) = 5.2, p = 0.007. Post-hoc Tukey: A vs C có khác biệt.',
    formula: 'F = MS_between / MS_within',
    id: 'anova',
    keywords: ['anova', 'one-way', 'analysis of variance', 'phân tích phương sai'],
    related: ['ttest_ind', 'kruskal'],
    summary:
      'So sánh trung bình ≥3 nhóm độc lập. Nếu F có ý nghĩa → dùng post-hoc test để xác định cặp nào khác.',
    tips: 'ANOVA chỉ cho biết CÓ khác biệt, không cho biết NHỎ cặp nào. Luôn dùng post-hoc. Không chuẩn → Kruskal-Wallis.',
    title: 'ANOVA',
  },
  {
    category: 'Kiểm định',
    example: 'Thuốc A: 30/50 đáp ứng, thuốc B: 20/50 đáp ứng. χ² = 4.17, p = 0.041.',
    formula: 'χ² = Σ(O - E)² / E',
    id: 'chisquare',
    keywords: ['chi-square', 'chi bình phương', 'categorical', 'tần số'],
    related: ['fisher', 'rr'],
    summary:
      'So sánh tỉ lệ hoặc tần số giữa các nhóm cho biến categorical. Cần tần số kỳ vọng ≥ 5/ô.',
    tips: 'Tần số kỳ vọng < 5 → dùng Fisher exact test. Bảng 2×2 → tính thêm OR, RR, NNT.',
    title: 'Chi-square Test',
  },
  {
    category: 'Kiểm định',
    example:
      'So sánh thang điểm đau (1-10) giữa nhóm A (Md=4) và nhóm B (Md=7). U = 180, p = 0.003.',
    id: 'mann_whitney',
    keywords: ['mann-whitney', 'u test', 'phi tham số', 'non-parametric', 'rank'],
    related: ['ttest_ind', 'wilcoxon'],
    summary:
      'Phiên bản phi tham số của independent t-test. Dùng rank thay giá trị gốc. Không cần phân phối chuẩn.',
    tips: 'Báo cáo Median + IQR. Effect size: r = Z/√N. Dữ liệu ordinal (Likert) luôn dùng Mann-Whitney.',
    title: 'Mann-Whitney U Test',
  },
  {
    category: 'Kiểm định',
    example: 'Đau trước: Median = 7, sau: Median = 4. Wilcoxon W = 15, p = 0.008.',
    id: 'wilcoxon',
    keywords: ['wilcoxon', 'signed-rank', 'phi tham số ghép cặp'],
    related: ['ttest_paired', 'mann_whitney'],
    summary:
      'Phiên bản phi tham số của paired t-test. Dựa trên rank của difference. Dùng khi d không chuẩn.',
    tips: 'Dùng cho dữ liệu ordinal trước-sau. Symmetric distribution of differences không bắt buộc nghiêm ngặt.',
    title: 'Wilcoxon Signed-Rank Test',
  },
  {
    category: 'Tương quan',
    example: 'BMI vs HA: r = 0.65, p < 0.001. r² = 0.42 → BMI giải thích 42% biến thiên HA.',
    formula: 'r = Σ(xᵢ - x̄)(yᵢ - ȳ) / √[Σ(xᵢ-x̄)² × Σ(yᵢ-ȳ)²]',
    id: 'pearson',
    keywords: ['pearson', 'correlation', 'tương quan', 'r', 'linear'],
    related: ['spearman', 'regression'],
    summary:
      'Đo tương quan tuyến tính giữa 2 biến liên tục. r: -1 đến 1. Cần phân phối chuẩn + quan hệ tuyến tính.',
    tips: 'Tương quan ≠ nhân quả! r = 0.3 (yếu), 0.5 (trung bình), 0.7 (mạnh). Kiểm tra scatter plot trước.',
    title: 'Pearson Correlation',
  },
  {
    category: 'Tương quan',
    example: 'Mức độ đau (1-10) vs chất lượng cuộc sống (1-100): ρ = -0.72, p < 0.001.',
    formula: 'ρ = 1 - 6Σdᵢ² / (n(n²-1))',
    id: 'spearman',
    keywords: ['spearman', 'rank correlation', 'tương quan thứ hạng', 'rho'],
    related: ['pearson', 'kendall'],
    summary:
      'Tương quan rank cho biến ordinal hoặc dữ liệu không chuẩn. Đo quan hệ đơn điệu (monotonic).',
    tips: 'Dùng cho Likert scale, ordinal data, hoặc khi Pearson assumptions bị vi phạm. Robust với outliers.',
    title: 'Spearman Correlation',
  },
  {
    category: 'Survival',
    example: 'Đường cong KM cho thấy survival 5 năm nhóm phẫu thuật = 72%, nhóm hoá trị = 45%.',
    formula: 'S(t) = Π(1 - dᵢ/nᵢ)',
    id: 'kaplan_meier',
    keywords: ['kaplan-meier', 'survival curve', 'đường cong sống sót', 'km'],
    related: ['logrank', 'cox'],
    summary:
      'Ước tính xác suất sống sót (hoặc event-free) theo thời gian. Xử lý được censored data.',
    tips: 'Median survival = thời điểm S(t) = 0.5. Dùng log-rank test để so sánh đường cong giữa nhóm.',
    title: 'Kaplan-Meier',
  },
  {
    category: 'Survival',
    example: 'Log-rank test: χ² = 8.5, p = 0.004 → đường cong survival 2 nhóm khác biệt ý nghĩa.',
    id: 'logrank',
    keywords: ['log-rank', 'survival comparison', 'so sánh đường cong'],
    related: ['kaplan_meier', 'cox'],
    summary: 'So sánh đường cong survival giữa 2+ nhóm. Giả định: proportional hazards.',
    tips: 'Nếu đường cong giao nhau → log-rank không phù hợp. Dùng restricted mean survival time (RMST) thay.',
    title: 'Log-rank Test',
  },
  {
    category: 'Survival',
    example:
      'Cox: HR cho tuổi = 1.03 (95% CI: 1.01-1.05) → mỗi năm tăng tuổi, risk tử vong tăng 3%.',
    formula: 'h(t) = h₀(t) × exp(β₁X₁ + β₂X₂ + ...)',
    id: 'cox',
    keywords: ['cox', 'hazard ratio', 'hr', 'proportional hazards', 'regression'],
    related: ['kaplan_meier', 'logrank'],
    summary:
      'Mô hình hồi quy cho survival data, kiểm soát nhiều biến. HR = exp(β) đo nguy cơ tương đối.',
    tips: 'Kiểm tra PH assumption bằng Schoenfeld residuals. HR > 1: tăng risk. HR < 1: giảm risk.',
    title: 'Cox Regression',
  },
  {
    category: 'Đo lường',
    example:
      'Nhóm thuốc: 20/100 tử vong (20%). Giả dược: 30/100 (30%). RR = 0.67 → giảm 33% nguy cơ.',
    formula: 'RR = Risk_exposed / Risk_unexposed',
    id: 'rr',
    keywords: ['relative risk', 'nguy cơ tương đối', 'rr', 'cohort'],
    related: ['or', 'nnt', 'arr'],
    summary:
      'Tỉ số nguy cơ giữa nhóm phơi nhiễm và không phơi nhiễm. Dùng trong cohort study và RCT.',
    tips: 'RR = 1: không khác biệt. RR < 1: bảo vệ. RR > 1: tăng nguy cơ. RR không dùng cho case-control.',
    title: 'Relative Risk (RR)',
  },
  {
    category: 'Đo lường',
    example: 'Case-control: OR = 2.5 (95% CI: 1.3-4.8) → odds bệnh ở nhóm phơi nhiễm gấp 2.5 lần.',
    formula: 'OR = (a×d) / (b×c)',
    id: 'or',
    keywords: ['odds ratio', 'tỉ số chênh', 'or', 'case-control'],
    related: ['rr', 'chisquare'],
    summary: 'Tỉ số odds giữa 2 nhóm. Dùng trong case-control study. OR ≈ RR khi tỉ lệ bệnh < 10%.',
    tips: 'Logistic regression output cho OR. OR > 1: tăng odds. OR < 1: giảm odds. CI chứa 1 → không ý nghĩa.',
    title: 'Odds Ratio (OR)',
  },
  {
    category: 'Đo lường',
    example: 'ARR = 30% - 20% = 10%. NNT = 1/0.10 = 10. Điều trị 10 người để 1 người hưởng lợi.',
    formula: 'NNT = 1 / ARR = 1 / |Risk₁ - Risk₂|',
    id: 'nnt',
    keywords: ['nnt', 'number needed to treat', 'arr', 'absolute risk reduction'],
    related: ['rr', 'or'],
    summary: 'Số bệnh nhân cần điều trị để 1 người hưởng lợi. NNT thấp → hiệu quả cao.',
    tips: 'NNT = 1-5: rất hiệu quả. NNT > 40: hiệu quả thấp. NNH = Number Needed to Harm = 1/ARI.',
    title: 'NNT (Number Needed to Treat)',
  },
  {
    category: 'Chẩn đoán',
    example:
      'Test HIV nhanh: Se = 99.7%, Sp = 98.5%. Trong quần thể prevalence 0.1%: PPV chỉ ≈ 6.2%!',
    formula: 'Se = TP/(TP+FN), Sp = TN/(TN+FP)',
    id: 'se_sp',
    keywords: ['sensitivity', 'specificity', 'độ nhạy', 'độ đặc hiệu', 'diagnostic'],
    related: ['ppv_npv', 'roc'],
    summary:
      'Se = khả năng phát hiện bệnh. Sp = khả năng loại trừ bệnh. SnNout: Se cao → Negative loại trừ.',
    tips: 'Se cao → ít bỏ sót (FN thấp). Sp cao → ít dương tính giả (FP thấp). Trade-off: tăng Se thường giảm Sp.',
    title: 'Sensitivity & Specificity',
  },
  {
    category: 'Chẩn đoán',
    example: 'Test với Se=90%, Sp=95%, Prevalence=5%. PPV = 49%, NPV = 99.4%.',
    formula: 'PPV = TP/(TP+FP), NPV = TN/(TN+FN)',
    id: 'ppv_npv',
    keywords: ['ppv', 'npv', 'predictive value', 'giá trị tiên đoán'],
    related: ['se_sp', 'prevalence'],
    summary:
      'PPV = xác suất thực sự bệnh khi test dương. NPV = xác suất thực sự không bệnh khi test âm.',
    tips: 'PPV phụ thuộc MẠNH vào prevalence! Prevalence thấp → PPV thấp dù Se, Sp cao. Dùng Bayes theorem.',
    title: 'PPV & NPV',
  },
  {
    category: 'Thiết kế',
    example: 'RCT thuốc A vs giả dược: random hóa 200 bệnh nhân, double-blind, ITT analysis.',
    id: 'rct',
    keywords: ['rct', 'randomized controlled trial', 'thử nghiệm lâm sàng', 'randomization'],
    related: ['cohort', 'bias'],
    summary:
      'Tiêu chuẩn vàng trong nghiên cứu can thiệp. Random hóa giảm thiểu confounding. Blinding giảm bias.',
    tips: 'ITT (Intention-to-Treat) bảo toàn lợi ích randomization. Per-protocol có thể bị bias. CONSORT guideline.',
    title: 'RCT (Thử nghiệm lâm sàng)',
  },
  {
    category: 'Thiết kế',
    example: 'Cohort 10,000 người theo dõi 10 năm: hút thuốc → RR ung thư phổi = 15.0.',
    id: 'cohort',
    keywords: ['cohort', 'thuần tập', 'prospective', 'retrospective'],
    related: ['rct', 'case_control', 'rr'],
    summary:
      'Theo dõi nhóm phơi nhiễm và không phơi nhiễm theo thời gian. Tính được RR. Prospective hoặc retrospective.',
    tips: 'Ưu: tính nguyên nhân mạnh hơn case-control. Nhược: tốn thời gian, loss to follow-up. Dùng cho bệnh phổ biến.',
    title: 'Cohort Study (Nghiên cứu thuần tập)',
  },
];

// ── Styles ─────────────────────────────────────────────────────────────────
const useStyles = createStyles(({ css, token }) => ({
  card: css`
    cursor: pointer;

    padding: 14px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};

    transition: all 0.15s;

    &:hover {
      border-color: ${token.colorPrimary};
    }
  `,
  container: css`
    width: 100%;
    max-width: 700px;
    margin-block: 0;
    margin-inline: auto;
    padding-block-start: 8px;
  `,
  pill: css`
    cursor: pointer;

    display: inline-flex;
    gap: 5px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 12px;
    border: 1.5px solid ${token.colorBorderSecondary};
    border-radius: 16px;

    font-size: 11px;
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
  searchInput: css`
    width: 100%;
    padding-block: 8px;
    padding-inline: 34px 12px;
    border: 1.5px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    font-size: 13px;
    color: ${token.colorText};

    background: ${token.colorFillQuaternary};
    outline: none;

    transition: border-color 0.2s;

    &::placeholder {
      color: ${token.colorTextQuaternary};
    }

    &:focus {
      border-color: ${token.colorPrimary};
    }
  `,
}));

// ── Main Component ─────────────────────────────────────────────────────────
const KnowledgeBase = memo(() => {
  const { styles } = useStyles();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());

  const categories = useMemo(() => ['all', ...new Set(KB_ENTRIES.map((e) => e.category))], []);

  const filtered = useMemo(() => {
    let entries = KB_ENTRIES;
    if (category === 'bookmarks') entries = entries.filter((e) => bookmarks.has(e.id));
    else if (category !== 'all') entries = entries.filter((e) => e.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.keywords.some((k) => k.includes(q)),
      );
    }
    return entries;
  }, [search, category, bookmarks]);

  const toggleBookmark = (id: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox align={'center'} gap={8} horizontal>
        <BookOpen color="#63e2b7" size={18} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Bách khoa Thống kê Y học</span>
        <Tag bordered={false} style={{ fontSize: 10 }}>
          {KB_ENTRIES.length} mục
        </Tag>
      </Flexbox>

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search
          color="rgba(255,255,255,0.3)"
          size={16}
          style={{ left: 10, position: 'absolute', top: 10 }}
        />
        <input
          className={styles.searchInput}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm kiếm... (VD: t-test, p-value, survival)"
          value={search}
        />
      </div>

      {/* Category filter */}
      <Flexbox gap={6} horizontal wrap={'wrap'}>
        {categories.map((cat) => (
          <button
            className={`${styles.pill} ${category === cat ? 'active' : ''}`}
            key={cat}
            onClick={() => setCategory(cat)}
            type="button"
          >
            {cat === 'all' ? '📚 Tất cả' : cat}
          </button>
        ))}
        <button
          className={`${styles.pill} ${category === 'bookmarks' ? 'active' : ''}`}
          onClick={() => setCategory('bookmarks')}
          type="button"
        >
          <BookMarked size={11} />
          Đã lưu ({bookmarks.size})
        </button>
      </Flexbox>

      {/* Results count */}
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
        {filtered.length} kết quả
      </span>

      {/* Entries */}
      <Flexbox gap={8}>
        {filtered.map((entry) => {
          const isExpanded = expandedId === entry.id;
          return (
            <div className={styles.card} key={entry.id}>
              {/* Header row */}
              <Flexbox
                align={'center'}
                horizontal
                justify={'space-between'}
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              >
                <Flexbox align={'center'} gap={8} horizontal>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{entry.title}</span>
                  <Tag bordered={false} style={{ fontSize: 9 }}>
                    {entry.category}
                  </Tag>
                </Flexbox>
                <Flexbox align={'center'} gap={6} horizontal>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBookmark(entry.id);
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                    type="button"
                  >
                    <Star
                      color={bookmarks.has(entry.id) ? '#fadb14' : 'rgba(255,255,255,0.2)'}
                      fill={bookmarks.has(entry.id) ? '#fadb14' : 'none'}
                      size={14}
                    />
                  </button>
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </Flexbox>
              </Flexbox>

              {/* Summary (always visible) */}
              <p style={{ fontSize: 12, lineHeight: 1.6, marginTop: 6, opacity: 0.75 }}>
                {entry.summary}
              </p>

              {/* Expanded content */}
              {isExpanded && (
                <Flexbox gap={12} style={{ marginTop: 12 }}>
                  {/* Formula */}
                  {entry.formula && (
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.6 }}>
                        📐 CÔNG THỨC
                      </span>
                      <code
                        style={{
                          background: 'rgba(99,226,183,0.08)',
                          border: '1px solid rgba(99,226,183,0.2)',
                          borderRadius: 6,
                          display: 'block',
                          fontFamily: 'monospace',
                          fontSize: 13,
                          marginTop: 4,
                          padding: '6px 10px',
                        }}
                      >
                        {entry.formula}
                      </code>
                    </div>
                  )}

                  {/* Example */}
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.6 }}>
                      🏥 VÍ DỤ LÂM SÀNG
                    </span>
                    <p style={{ fontSize: 12, lineHeight: 1.6, marginTop: 4 }}>{entry.example}</p>
                  </div>

                  {/* Tips */}
                  <div
                    style={{
                      background: 'rgba(250,140,22,0.06)',
                      borderLeft: '3px solid rgba(250,140,22,0.4)',
                      borderRadius: 4,
                      padding: '8px 12px',
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.6 }}>💡 MẸO</span>
                    <p style={{ fontSize: 12, lineHeight: 1.6, marginTop: 4 }}>{entry.tips}</p>
                  </div>

                  {/* Related */}
                  {entry.related.length > 0 && (
                    <Flexbox gap={6} horizontal wrap={'wrap'}>
                      <span style={{ fontSize: 11, opacity: 0.5 }}>Liên quan:</span>
                      {entry.related.map((r) => {
                        const rel = KB_ENTRIES.find((e) => e.id === r);
                        return rel ? (
                          <button
                            key={r}
                            onClick={() => setExpandedId(r)}
                            style={{
                              background: 'rgba(22,119,255,0.08)',
                              border: '1px solid rgba(22,119,255,0.2)',
                              borderRadius: 10,
                              color: '#1677ff',
                              cursor: 'pointer',
                              fontSize: 11,
                              padding: '2px 8px',
                            }}
                            type="button"
                          >
                            {rel.title}
                          </button>
                        ) : null;
                      })}
                    </Flexbox>
                  )}
                </Flexbox>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <Flexbox
            align={'center'}
            gap={8}
            style={{ opacity: 0.5, padding: 32, textAlign: 'center' }}
          >
            <Search size={24} />
            <span style={{ fontSize: 13 }}>Không tìm thấy kết quả</span>
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

KnowledgeBase.displayName = 'KnowledgeBase';
export default KnowledgeBase;
