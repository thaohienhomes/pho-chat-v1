'use client';

/**
 * MED-45: Learning Modules — Quizzes & Flashcards
 *
 * Two modes:
 * 1. Quiz Mode — MCQ with 4 options, explanations, score tracking, progress bar
 * 2. Flashcard Mode — flip cards (front: term, back: definition + formula)
 *
 * Content covers 25+ biostatistics concepts relevant to medical research.
 * All in Vietnamese with English technical terms.
 */
import { Button, Tag } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FlipHorizontal,
  RotateCcw,
  Trophy,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

// ── Types ──────────────────────────────────────────────────────────────────
interface QuizQuestion {
  answer: number; // index of correct option
  explanation: string;
  options: string[];
  question: string;
}

interface Flashcard {
  back: string;
  category: string;
  front: string;
}

// ── Quiz Bank ──────────────────────────────────────────────────────────────
const QUIZ_BANK: QuizQuestion[] = [
  {
    answer: 1,
    explanation:
      'Independent t-test so sánh trung bình 2 nhóm độc lập khi dữ liệu phân phối chuẩn. Mann-Whitney dùng khi không chuẩn.',
    options: ['Mann-Whitney U', 'Independent t-test', 'Chi-square test', 'ANOVA'],
    question:
      'So sánh huyết áp trung bình giữa nhóm thuốc A và nhóm giả dược, dữ liệu phân phối chuẩn. Nên dùng kiểm định nào?',
  },
  {
    answer: 2,
    explanation:
      'Paired t-test dùng cho dữ liệu ghép cặp (trước-sau) với phân phối chuẩn. Wilcoxon signed-rank cho dữ liệu không chuẩn.',
    options: ['Independent t-test', 'ANOVA', 'Paired t-test', 'Wilcoxon signed-rank'],
    question:
      'So sánh cân nặng trước và sau chương trình giảm cân trên cùng nhóm bệnh nhân. Dữ liệu chuẩn. Dùng kiểm định gì?',
  },
  {
    answer: 0,
    explanation:
      'ANOVA one-way so sánh trung bình ≥3 nhóm độc lập. Nếu p < 0.05, dùng post-hoc (Tukey/Bonferroni) để xác định cặp nào khác.',
    options: ['ANOVA', 'Multiple t-tests', 'Kruskal-Wallis', 'Chi-square'],
    question: 'So sánh hiệu quả 3 loại thuốc giảm đau (liên tục, chuẩn). Nên dùng:',
  },
  {
    answer: 1,
    explanation:
      'Chi-square test so sánh tỉ lệ/tần số giữa các nhóm cho biến categorical. Fisher exact khi n nhỏ (tần số kỳ vọng < 5).',
    options: ['Independent t-test', 'Chi-square test', 'Pearson correlation', 'Log-rank test'],
    question: 'So sánh tỉ lệ đáp ứng điều trị (có/không) giữa 2 nhóm bệnh nhân. Dùng:',
  },
  {
    answer: 3,
    explanation:
      'Kaplan-Meier ước tính xác suất sống sót theo thời gian. Log-rank so sánh các đường cong. Cox điều chỉnh nhiều biến.',
    options: ['Cox regression', 'Chi-square', 'Log-rank test', 'Kaplan-Meier'],
    question: 'Muốn vẽ đường cong sống sót (survival curve) theo thời gian. Phương pháp nào?',
  },
  {
    answer: 0,
    explanation:
      'Pearson r đo tương quan tuyến tính giữa 2 biến liên tục có phân phối chuẩn. r = 0.7 → tương quan mạnh.',
    options: [
      'Pearson correlation',
      'Spearman correlation',
      'Chi-square test',
      'Linear regression',
    ],
    question:
      'Đánh giá mối tương quan tuyến tính giữa BMI và huyết áp (2 biến liên tục, chuẩn). Dùng:',
  },
  {
    answer: 2,
    explanation:
      'Mann-Whitney U là phiên bản phi tham số (non-parametric) của independent t-test, dùng khi dữ liệu không phân phối chuẩn.',
    options: ['Paired t-test', 'ANOVA', 'Mann-Whitney U', 'Wilcoxon signed-rank'],
    question: 'So sánh thang điểm đau (ordinal) giữa 2 nhóm điều trị. Dữ liệu lệch. Dùng:',
  },
  {
    answer: 1,
    explanation:
      'p-value = xác suất quan sát kết quả cực đoan như vậy hoặc hơn nếu H₀ đúng. p < 0.05 → bác bỏ H₀.',
    options: [
      'Xác suất H₀ đúng',
      'Xác suất kết quả cực đoan nếu H₀ đúng',
      'Xác suất H₁ đúng',
      'Xác suất sai lầm loại II',
    ],
    question: 'P-value = 0.03. Đây là gì?',
  },
  {
    answer: 0,
    explanation:
      'Power = 1 - β = xác suất phát hiện khác biệt thật (bác bỏ H₀ khi H₁ đúng). Mục tiêu ≥ 80%.',
    options: [
      '1 - β (xác suất phát hiện khác biệt thật)',
      '1 - α',
      'Xác suất H₀ đúng',
      'Cỡ mẫu tối thiểu',
    ],
    question: 'Power (lực thống kê) là gì?',
  },
  {
    answer: 2,
    explanation: 'Sai lầm loại I (α) = bác bỏ H₀ khi H₀ đúng = dương tính giả. Thường α = 0.05.',
    options: [
      'Không bác bỏ H₀ khi H₀ sai',
      'Kết quả không lặp lại',
      'Bác bỏ H₀ khi H₀ đúng',
      'Cỡ mẫu quá nhỏ',
    ],
    question: 'Sai lầm loại I (Type I error) là gì?',
  },
  {
    answer: 3,
    explanation:
      'Median (trung vị) ít bị ảnh hưởng bởi giá trị cực đoan. Mean bị kéo lệch khi có outliers.',
    options: ['Mean', 'Mode', 'Standard Deviation', 'Median'],
    question: 'Khi dữ liệu bị lệch (skewed), đại lượng nào mô tả xu hướng trung tâm tốt hơn?',
  },
  {
    answer: 1,
    explanation:
      'NNT = 1/ARR. Nếu thuốc giảm nguy cơ 10% (ARR=0.10), cần điều trị 10 người để 1 người hưởng lợi.',
    options: ['Odds Ratio', 'Number Needed to Treat (NNT)', 'Relative Risk', 'Hazard Ratio'],
    question: '"Cần điều trị bao nhiêu bệnh nhân để 1 người hưởng lợi?" — đây là chỉ số:',
  },
  {
    answer: 0,
    explanation:
      '95% CI = khoảng mà 95% lần lặp lại thí nghiệm, giá trị thật sẽ nằm trong đó. CI hẹp → ước tính chính xác hơn.',
    options: [
      'Khoảng chứa giá trị thật với xác suất 95% qua nhiều lần lặp',
      '95% dữ liệu nằm trong khoảng này',
      'p < 0.05 luôn nằm trong CI',
      'Xác suất H₀ nằm trong khoảng',
    ],
    question: 'Khoảng tin cậy 95% (95% CI) có ý nghĩa gì?',
  },
  {
    answer: 2,
    explanation:
      'Kruskal-Wallis là phi tham số cho ≥3 nhóm độc lập. Tương đương ANOVA nhưng không cần phân phối chuẩn.',
    options: ['ANOVA', 'Friedman test', 'Kruskal-Wallis', 'Wilcoxon'],
    question: 'So sánh 4 nhóm bệnh nhân với biến thứ tự (ordinal). Kiểm định phi tham số nào?',
  },
  {
    answer: 1,
    explanation:
      'Spearman ρ đo tương quan đơn điệu (monotonic) cho biến ordinal hoặc không chuẩn. Không yêu cầu tuyến tính.',
    options: ['Pearson r', 'Spearman ρ', 'Kendall τ', 'Point-biserial'],
    question:
      'Tương quan giữa mức độ đau (thang 1-10) và chất lượng cuộc sống (thang Likert). Dùng:',
  },
];

// ── Flashcard Bank ─────────────────────────────────────────────────────────
const FLASHCARD_BANK: Flashcard[] = [
  {
    back: 'Giá trị trung bình = tổng / n\nCông thức: X̄ = ΣXᵢ / n\nNhạy cảm với outliers.',
    category: 'Mô tả',
    front: 'Mean (Trung bình)',
  },
  {
    back: 'Giá trị ở vị trí giữa khi sắp xếp.\nKhông bị ảnh hưởng bởi outliers.\nDùng khi dữ liệu lệch (skewed).',
    category: 'Mô tả',
    front: 'Median (Trung vị)',
  },
  {
    back: 'Đo mức độ phân tán quanh mean.\nCông thức: s = √[Σ(Xᵢ - X̄)² / (n-1)]\nĐơn vị = đơn vị gốc.',
    category: 'Mô tả',
    front: 'Standard Deviation (Độ lệch chuẩn)',
  },
  {
    back: 'Q3 - Q1 = khoảng chứa 50% dữ liệu ở giữa.\nDùng kết hợp với Median khi dữ liệu lệch.',
    category: 'Mô tả',
    front: 'IQR (Khoảng tứ phân vị)',
  },
  {
    back: 'p < 0.05 → bác bỏ H₀\nLà xác suất quan sát kết quả cực đoan nếu H₀ đúng.\nKHÔNG phải xác suất H₀ đúng!',
    category: 'Suy luận',
    front: 'P-value',
  },
  {
    back: 'α = sai lầm loại I = bác bỏ H₀ khi H₀ đúng\nβ = sai lầm loại II = không bác bỏ H₀ khi H₁ đúng\nThường α = 0.05, β = 0.20',
    category: 'Suy luận',
    front: 'Type I vs Type II Error',
  },
  {
    back: 'Power = 1 - β\nXác suất phát hiện hiệu quả thật.\nTăng power bằng: tăng n, tăng effect size, tăng α.',
    category: 'Suy luận',
    front: 'Power (Lực thống kê)',
  },
  {
    back: 'Khoảng chứa giá trị thật với xác suất 95%.\nCông thức: X̄ ± 1.96 × SE\nCI hẹp → ước tính chính xác.',
    category: 'Suy luận',
    front: '95% Confidence Interval',
  },
  {
    back: 'So sánh trung bình 2 nhóm ĐỘC LẬP.\nĐiều kiện: phân phối chuẩn, đồng phương sai.\nt = (X̄₁ - X̄₂) / SE',
    category: 'Kiểm định',
    front: 'Independent t-test',
  },
  {
    back: 'So sánh trước-sau trên CÙNG đối tượng.\nĐiều kiện: difference phân phối chuẩn.\nt = d̄ / (sd / √n)',
    category: 'Kiểm định',
    front: 'Paired t-test',
  },
  {
    back: 'So sánh trung bình ≥3 nhóm.\nF = MS_between / MS_within\nNếu p < 0.05 → dùng post-hoc test.',
    category: 'Kiểm định',
    front: 'ANOVA',
  },
  {
    back: 'So sánh tỉ lệ / tần số giữa các nhóm.\nχ² = Σ(O - E)² / E\nĐiều kiện: tần số kỳ vọng ≥ 5.',
    category: 'Kiểm định',
    front: 'Chi-square Test',
  },
  {
    back: 'Phi tham số thay cho independent t-test.\nDùng rank thay giá trị gốc.\nKhông cần phân phối chuẩn.',
    category: 'Kiểm định',
    front: 'Mann-Whitney U',
  },
  {
    back: 'Phi tham số thay cho paired t-test.\nDựa trên rank của difference.\nDùng khi d không phân phối chuẩn.',
    category: 'Kiểm định',
    front: 'Wilcoxon Signed-Rank',
  },
  {
    back: 'Đo tương quan tuyến tính giữa 2 biến liên tục.\nr: -1 → 1.  |r| > 0.5 = mạnh.\nr² = tỉ lệ biến thiên giải thích.',
    category: 'Tương quan',
    front: 'Pearson Correlation (r)',
  },
  {
    back: 'Tương quan rank cho biến ordinal hoặc không chuẩn.\nρ: -1 → 1. Đo mối quan hệ đơn điệu.\nKhông cần phân phối chuẩn.',
    category: 'Tương quan',
    front: 'Spearman Correlation (ρ)',
  },
  {
    back: 'S(t) = Π(1 - dᵢ/nᵢ)\nƯớc tính xác suất sống sót theo thời gian.\nĐường cong giảm theo bậc thang.',
    category: 'Survival',
    front: 'Kaplan-Meier Estimator',
  },
  {
    back: 'So sánh 2+ đường cong survival.\nH₀: không khác biệt giữa các nhóm.\nBáo cáo HR và 95% CI.',
    category: 'Survival',
    front: 'Log-rank Test',
  },
  {
    back: 'h(t) = h₀(t) × exp(β₁X₁ + ...)\nHR > 1: tăng risk. HR < 1: giảm risk.\nĐiều kiện: proportional hazards.',
    category: 'Survival',
    front: 'Cox Regression',
  },
  {
    back: 'RR = risk exposed / risk unexposed\nDùng trong cohort study.\nRR = 2.0 → nguy cơ gấp đôi.',
    category: 'Đo lường',
    front: 'Relative Risk (RR)',
  },
  {
    back: 'OR = (a×d) / (b×c) từ bảng 2×2.\nDùng trong case-control study.\nOR ≈ RR khi tỉ lệ bệnh thấp.',
    category: 'Đo lường',
    front: 'Odds Ratio (OR)',
  },
  {
    back: 'NNT = 1 / ARR\nSố bệnh nhân cần điều trị để 1 người hưởng lợi.\nNNT thấp → hiệu quả điều trị cao.',
    category: 'Đo lường',
    front: 'NNT (Number Needed to Treat)',
  },
  {
    back: 'Se = TP / (TP + FN) → phát hiện bệnh\nSp = TN / (TN + FP) → loại trừ bệnh\nSnNout / SpPin rule.',
    category: 'Chẩn đoán',
    front: 'Sensitivity & Specificity',
  },
  {
    back: 'PPV = TP / (TP + FP) → đúng dương tính\nNPV = TN / (TN + FN) → đúng âm tính\nPhụ thuộc vào prevalence!',
    category: 'Chẩn đoán',
    front: 'PPV & NPV',
  },
];

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
  flashcard: css`
    cursor: pointer;

    position: relative;

    min-height: 200px;
    padding: 24px;
    border-radius: ${token.borderRadiusLG}px;

    transition:
      transform 0.4s ease,
      box-shadow 0.3s;

    &:hover {
      transform: scale(1.01);
    }
  `,
  label: css`
    font-size: 11px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
  option: css`
    cursor: pointer;

    width: 100%;
    padding-block: 10px;
    padding-inline: 14px;
    border: 1.5px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    font-size: 13px;
    color: ${token.colorText};
    text-align: start;

    background: ${token.colorBgContainer};

    transition: all 0.15s ease;

    &:disabled {
      cursor: default;
      opacity: 0.85;
    }

    &:hover:not(:disabled) {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
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
  stat: css`
    padding-block: 4px;
    padding-inline: 10px;
    border-radius: 8px;

    font-size: 12px;
    font-weight: 700;
    text-align: center;
  `,
}));

// ── Quiz Component ─────────────────────────────────────────────────────────
const QuizMode = memo(() => {
  const { styles } = useStyles();
  const [questions] = useState(() => [...QUIZ_BANK].sort(() => Math.random() - 0.5).slice(0, 10));
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const q = questions[current];

  const handleSelect = useCallback(
    (idx: number) => {
      if (selected !== null) return;
      setSelected(idx);
      if (idx === q.answer) setScore((s) => s + 1);
    },
    [selected, q],
  );

  const handleNext = useCallback(() => {
    if (current + 1 >= questions.length) {
      setFinished(true);
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
    }
  }, [current, questions.length]);

  const handleReset = useCallback(() => {
    setCurrent(0);
    setSelected(null);
    setScore(0);
    setFinished(false);
  }, []);

  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    const grade = pct >= 80 ? '🏆 Xuất sắc!' : pct >= 60 ? '👍 Khá tốt!' : '📚 Cần ôn thêm';
    const gradeColor = pct >= 80 ? '#52c41a' : pct >= 60 ? '#fa8c16' : '#ef4444';
    return (
      <Flexbox
        align={'center'}
        className={styles.card}
        gap={16}
        style={{ padding: 32, textAlign: 'center' }}
      >
        <Trophy color={gradeColor} size={48} />
        <div style={{ color: gradeColor, fontSize: 28, fontWeight: 800 }}>{pct}%</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{grade}</div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          Đúng {score}/{questions.length} câu
        </div>
        <Button onClick={handleReset} size={'small'} style={{ marginTop: 8 }}>
          <RotateCcw size={12} /> Làm lại
        </Button>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={16}>
      {/* Progress */}
      <Flexbox align={'center'} gap={10} horizontal justify={'space-between'}>
        <span className={styles.label}>
          Câu {current + 1}/{questions.length}
        </span>
        <Flexbox gap={4} horizontal>
          {questions.map((_, i) => (
            <div
              key={i}
              style={{
                background:
                  i < current ? '#52c41a' : i === current ? '#1677ff' : 'rgba(255,255,255,0.1)',
                borderRadius: 4,
                height: 6,
                transition: 'background 0.2s',
                width: 24,
              }}
            />
          ))}
        </Flexbox>
      </Flexbox>

      {/* Question */}
      <div className={styles.card}>
        <p style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.5, marginBottom: 16 }}>
          {q.question}
        </p>
        <Flexbox gap={8}>
          {q.options.map((opt, i) => {
            let borderColor = 'transparent';
            let bg = '';
            if (selected !== null) {
              if (i === q.answer) {
                borderColor = '#52c41a';
                bg = 'rgba(82,196,26,0.08)';
              } else if (i === selected) {
                borderColor = '#ef4444';
                bg = 'rgba(239,68,68,0.08)';
              }
            }
            return (
              <button
                className={styles.option}
                disabled={selected !== null}
                key={i}
                onClick={() => handleSelect(i)}
                style={{ background: bg, borderColor }}
                type="button"
              >
                <Flexbox align={'center'} gap={8} horizontal>
                  {selected !== null && i === q.answer && (
                    <CheckCircle2 color="#52c41a" size={14} />
                  )}
                  {selected !== null && i === selected && i !== q.answer && (
                    <XCircle color="#ef4444" size={14} />
                  )}
                  <span>{opt}</span>
                </Flexbox>
              </button>
            );
          })}
        </Flexbox>
      </div>

      {/* Explanation + Next */}
      {selected !== null && (
        <Flexbox gap={12}>
          <div
            className={styles.card}
            style={{ borderLeft: `3px solid ${selected === q.answer ? '#52c41a' : '#ef4444'}` }}
          >
            <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              {selected === q.answer ? '✅ Chính xác!' : '❌ Chưa đúng'}
            </p>
            <p style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.85 }}>{q.explanation}</p>
          </div>
          <Button onClick={handleNext} size={'small'} type={'primary'}>
            {current + 1 >= questions.length ? '🏁 Xem kết quả' : 'Câu tiếp →'}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
});
QuizMode.displayName = 'QuizMode';

// ── Flashcard Component ────────────────────────────────────────────────────
const FlashcardMode = memo(() => {
  const { styles } = useStyles();
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [category, setCategory] = useState<string>('all');

  const categories = ['all', ...new Set(FLASHCARD_BANK.map((f) => f.category))];
  const filteredCards =
    category === 'all' ? FLASHCARD_BANK : FLASHCARD_BANK.filter((f) => f.category === category);
  const card = filteredCards[current % filteredCards.length];

  const handleFlip = useCallback(() => setFlipped((f) => !f), []);
  const handleNext = useCallback(() => {
    setCurrent((c) => c + 1);
    setFlipped(false);
  }, []);
  const handlePrev = useCallback(() => {
    setCurrent((c) => Math.max(0, c - 1));
    setFlipped(false);
  }, []);

  return (
    <Flexbox gap={16}>
      {/* Category filter */}
      <Flexbox gap={6} horizontal wrap={'wrap'}>
        {categories.map((cat) => (
          <button
            className={`${styles.pill} ${category === cat ? 'active' : ''}`}
            key={cat}
            onClick={() => {
              setCategory(cat);
              setCurrent(0);
              setFlipped(false);
            }}
            type="button"
          >
            {cat === 'all' ? '📚 Tất cả' : cat}
          </button>
        ))}
      </Flexbox>

      {/* Card */}
      <div
        className={styles.flashcard}
        onClick={handleFlip}
        role="button"
        style={{
          background: flipped
            ? 'linear-gradient(135deg, rgba(22,119,255,0.12), rgba(114,46,209,0.08))'
            : 'linear-gradient(135deg, rgba(99,226,183,0.12), rgba(22,119,255,0.08))',
          border: `1.5px solid ${flipped ? 'rgba(22,119,255,0.3)' : 'rgba(99,226,183,0.3)'}`,
        }}
        tabIndex={0}
      >
        <Tag bordered={false} style={{ fontSize: 10, marginBottom: 12 }}>
          {card.category}
        </Tag>
        {!flipped ? (
          <Flexbox align={'center'} gap={12} justify={'center'} style={{ minHeight: 120 }}>
            <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'center' }}>{card.front}</div>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
              <FlipHorizontal size={12} style={{ marginRight: 4 }} />
              Nhấn để lật
            </span>
          </Flexbox>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-line' }}>{card.back}</div>
        )}
      </div>

      {/* Nav */}
      <Flexbox align={'center'} horizontal justify={'space-between'}>
        <Button disabled={current === 0} onClick={handlePrev} size={'small'}>
          ← Trước
        </Button>
        <span
          className={styles.stat}
          style={{ background: 'rgba(99,226,183,0.1)', color: '#63e2b7' }}
        >
          {(current % filteredCards.length) + 1} / {filteredCards.length}
        </span>
        <Button onClick={handleNext} size={'small'}>
          Tiếp →
        </Button>
      </Flexbox>
    </Flexbox>
  );
});
FlashcardMode.displayName = 'FlashcardMode';

// ── Main Component ─────────────────────────────────────────────────────────
type LearnMode = 'flashcard' | 'quiz';

const LearningModules = memo(() => {
  const { styles } = useStyles();
  const [mode, setMode] = useState<LearnMode>('quiz');

  return (
    <Flexbox className={styles.container} gap={16}>
      {/* Header */}
      <Flexbox gap={4}>
        <Flexbox align={'center'} gap={8} horizontal>
          <BookOpen color="#63e2b7" size={18} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>Ôn tập Thống kê Y học</span>
        </Flexbox>
        <span className={styles.label} style={{ textTransform: 'none' }}>
          Luyện tập kiến thức thống kê sinh học qua quiz và flashcard
        </span>
      </Flexbox>

      {/* Mode toggle */}
      <Flexbox gap={8} horizontal>
        <button
          className={`${styles.pill} ${mode === 'quiz' ? 'active' : ''}`}
          onClick={() => setMode('quiz')}
          type="button"
        >
          <ChevronRight size={12} />
          🧠 Quiz (10 câu)
        </button>
        <button
          className={`${styles.pill} ${mode === 'flashcard' ? 'active' : ''}`}
          onClick={() => setMode('flashcard')}
          type="button"
        >
          <FlipHorizontal size={12} />
          🃏 Flashcards
        </button>
      </Flexbox>

      {/* Content */}
      {mode === 'quiz' ? <QuizMode /> : <FlashcardMode />}
    </Flexbox>
  );
});

LearningModules.displayName = 'LearningModules';
export default LearningModules;
