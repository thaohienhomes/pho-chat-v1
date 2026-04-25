/**
 * LLM-based PICO extraction for clinical research questions.
 *
 * Replaces the previous keyword-regex approach (English-only, missed VN
 * questions, and produced primitive splits like Population="find about
 * SGA GH" / Intervention="therapy"). The LLM returns structured JSON in
 * English regardless of the source language. On any parse / network /
 * call failure, we fall back to a generic shape so the UI still renders.
 */

export interface PICOQuery {
  comparison: string;
  intervention: string;
  outcome: string;
  population: string;
}

export interface ExtractPICOResult {
  durationMs: number;
  fellBack: boolean;
  pico: PICOQuery;
}

type CallAI = (model: string, prompt: string, label?: string) => Promise<string>;

const PICO_PROMPT = (query: string) => `Extract PICO elements from this clinical research question.

Question: "${query}"

Return ONLY valid JSON in this exact shape (no markdown, no code fence, no explanation):
{
  "population": "<who is being studied — patient group, condition, age, etc>",
  "intervention": "<the treatment or exposure being evaluated>",
  "comparison": "<comparator group or alternative — use 'Placebo / Standard care' if not stated>",
  "outcome": "<what is being measured — efficacy, mortality, side effects, etc — use 'Clinical outcomes' if not stated>"
}

Use English for all values, even if the question is in another language.
If the question is too vague to extract a field, use a reasonable default ('Adult patients', 'Standard care', 'Clinical outcomes').
Maximum 15 words per field.`;

const FIELD_MAX_LEN = 200;

const buildFallback = (query: string): PICOQuery => ({
  comparison: 'Placebo / Standard care',
  intervention: query.slice(0, FIELD_MAX_LEN) || 'Intervention under study',
  outcome: 'Clinical outcomes',
  population: 'Study population',
});

export const extractPICO = async (
  query: string,
  callAI: CallAI,
  model: string,
): Promise<ExtractPICOResult> => {
  const startedAt = Date.now();
  const fallback = buildFallback(query);

  try {
    const raw = await callAI(model, PICO_PROMPT(query), 'extract-pico');
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    if (
      parsed &&
      typeof parsed.population === 'string' &&
      typeof parsed.intervention === 'string' &&
      typeof parsed.comparison === 'string' &&
      typeof parsed.outcome === 'string'
    ) {
      return {
        durationMs: Date.now() - startedAt,
        fellBack: false,
        pico: {
          comparison: parsed.comparison.slice(0, FIELD_MAX_LEN),
          intervention: parsed.intervention.slice(0, FIELD_MAX_LEN),
          outcome: parsed.outcome.slice(0, FIELD_MAX_LEN),
          population: parsed.population.slice(0, FIELD_MAX_LEN),
        },
      };
    }
  } catch (e) {
    console.warn('[extractPICO] failed, falling back', e);
  }

  return { durationMs: Date.now() - startedAt, fellBack: true, pico: fallback };
};
