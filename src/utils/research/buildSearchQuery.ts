/**
 * Build a search-engine-friendly query for PubMed / Semantic Scholar.
 *
 * Vietnamese clinical questions don't match English-indexed databases. We
 * detect Vietnamese input and ask the LLM to translate it into a concise
 * English PubMed-style query before hitting the literature APIs. The original
 * question is still used downstream (agent reasoning, outline, article output)
 * so the user-facing language stays unchanged.
 *
 * Returned metadata is logged to PostHog so we can measure translation hit
 * rate and diagnose 0-paper cases per source.
 */

// Vietnamese-specific diacritics + đ/Đ. Presence of any of these = Vietnamese.
const VIETNAMESE_REGEX =
  /[À-ÃÈ-ÊÌÍÒ-ÕÙÚÝà-ãè-êìíò-õùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;

// Anything outside printable ASCII (U+0020..U+007E) is non-English-friendly.
const NON_ASCII_REGEX = /[^\t\n\r -~]/;

export type DetectedLanguage = 'vi' | 'en' | 'other';

export const detectLanguage = (query: string): DetectedLanguage => {
  if (VIETNAMESE_REGEX.test(query)) return 'vi';
  if (NON_ASCII_REGEX.test(query)) return 'other';
  return 'en';
};

export interface BuildSearchQueryResult {
  detectedLanguage: DetectedLanguage;
  durationMs: number;
  fellBackToOriginal: boolean;
  originalQuery: string;
  searchQuery: string;
  translated: boolean;
}

type CallAI = (model: string, prompt: string, label?: string) => Promise<string>;

const cache = new Map<string, string>();

const buildTranslatePrompt = (question: string) =>
  `You are a medical informatics translator. Translate the following Vietnamese clinical/medical question into a concise English search query suitable for PubMed and Semantic Scholar.

Rules:
- Use standard English medical terminology (MeSH-style when natural, e.g., "growth hormone", "central precocious puberty", "GLP-1 receptor agonists").
- Preserve every clinically meaningful concept (population, intervention, comparison, outcome).
- Drop filler words ("xin", "cho tôi", "viết", "tổng quan về", "đánh giá", "review", "search", "tìm kiếm").
- Output ONLY the search query on a single line, no quotes, no markdown, no code fence, no explanation, no leading "Query:", maximum 25 words.

Examples:
Input: "tổng quan tác động GLP1a lên khí sắc semaglutide"
Output: GLP-1 receptor agonists semaglutide mood psychiatric effects

Input: "vai trò của metformin trong tiền tiểu đường"
Output: metformin prediabetes prevention

Input: "tăng trưởng chiều cao trẻ SGA non tháng dùng GH"
Output: growth hormone therapy small for gestational age preterm short stature

Vietnamese question:
${question}

English search query:`;

/**
 * Build the literature-search query. For Vietnamese input, translate via the
 * provided callAI. For English / other, return the question unchanged.
 *
 * Translation failures fall back to the original query (and emit a flag so the
 * caller can decide whether to warn the user).
 */
export const buildSearchQuery = async (
  question: string,
  callAI: CallAI,
  model: string,
): Promise<BuildSearchQueryResult> => {
  const startedAt = Date.now();
  const trimmed = question.trim();
  const detectedLanguage = detectLanguage(trimmed);

  if (detectedLanguage !== 'vi' || trimmed.length === 0) {
    return {
      detectedLanguage,
      durationMs: 0,
      fellBackToOriginal: false,
      originalQuery: trimmed,
      searchQuery: trimmed,
      translated: false,
    };
  }

  const cached = cache.get(trimmed);
  if (cached) {
    return {
      detectedLanguage: 'vi',
      durationMs: 0,
      fellBackToOriginal: false,
      originalQuery: trimmed,
      searchQuery: cached,
      translated: true,
    };
  }

  try {
    const raw = await callAI(model, buildTranslatePrompt(trimmed), 'translate-search-query');
    // NOTE: `String.prototype.replaceAll` throws TypeError when given a non-global
    // RegExp. The anchored "Query:" prefix only matches once, so use `.replace`
    // (single replacement) — using `replaceAll` here previously made every
    // translation throw and silently fall back to the original VN query.
    // Order matters: collapse whitespace + trim FIRST so the `^` anchors can
    // actually match leading prefixes the model loves to add.
    const cleaned = raw
      .replaceAll(/\s+/g, ' ')
      .trim()
      .replace(/^(query|search query|english query)\s*:\s*/i, '')
      .replaceAll(/^["']|["']$/g, '')
      .trim()
      .slice(0, 240);

    if (cleaned.length > 0 && /[a-z]/i.test(cleaned)) {
      cache.set(trimmed, cleaned);
      return {
        detectedLanguage: 'vi',
        durationMs: Date.now() - startedAt,
        fellBackToOriginal: false,
        originalQuery: trimmed,
        searchQuery: cleaned,
        translated: true,
      };
    }
  } catch (e) {
    console.warn('[buildSearchQuery] translation failed, falling back to original', e);
  }

  return {
    detectedLanguage: 'vi',
    durationMs: Date.now() - startedAt,
    fellBackToOriginal: true,
    originalQuery: trimmed,
    searchQuery: trimmed,
    translated: false,
  };
};
