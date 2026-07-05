/**
 * TranslationBatcher — Batch AI translation for diagram labels
 *
 * Uses Google Gemini API directly (via @google/genai SDK) for server-side
 * translation. Does NOT require user auth context.
 *
 * System prompt is optimized for:
 * - Short diagram labels (not full sentences)
 * - Technical terminology (construction, engineering, academic)
 * - Structured JSON output for reliable parsing
 */
import type { ExtractedText, Translation, TranslationOptions } from './types';

// ─── Constants ──────────────────────────────────────────────────────

/** Maximum texts per batch to stay within token limits */
const BATCH_SIZE = 50;

// ─── Prompt Templates ───────────────────────────────────────────────

function buildSystemPrompt(sourceLang: string, targetLang: string): string {
  return `You are a technical document translator specializing in construction, engineering, and academic terminology. You translate diagram labels (short phrases in boxes/shapes) from ${sourceLang} to ${targetLang}.

RULES:
- Keep translations concise — these are diagram labels, not paragraphs
- Preserve technical terminology accuracy
- If a term has a standard translation in the target field, use it
- Return ONLY valid JSON: {"translations": [{"id": "...", "translated": "..."}]}
- Do not translate proper nouns, abbreviations, or numbers
- Maintain the same level of formality as the original text
- For construction/engineering terms, use industry-standard translations`;
}

function buildBatchPrompt(texts: Array<{ id: string; text: string }>): string {
  const items = texts.map((t) => `  {"id": "${t.id}", "text": "${t.text}"}`).join(',\n');
  return `Translate these diagram labels:
[
${items}
]

Return JSON with translations for each id.`;
}

// ─── Language Detection ─────────────────────────────────────────────

/** Simple heuristic to detect source language from text samples */
function detectLanguage(texts: string[]): string {
  const sample = texts.slice(0, 10).join(' ');

  // Chinese characters (CJK Unified Ideographs)
  if (/[\u4E00-\u9FFF]/.test(sample)) return 'Chinese';

  // Japanese (Hiragana + Katakana)
  if (/[\u3040-\u30FF]/.test(sample)) return 'Japanese';

  // Korean (Hangul)
  if (/[\uAC00-\uD7AF]/.test(sample)) return 'Korean';

  // Vietnamese (Latin with specific diacritics)
  if (/[âêôăđơư]/i.test(sample)) return 'Vietnamese';

  // Default to English
  return 'English';
}

// ─── JSON Response Parser ───────────────────────────────────────────

function parseTranslationResponse(raw: string): Array<{ id: string; translated: string }> {
  let cleaned = raw.trim();

  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Find JSON boundaries
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object found in translation response');
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  const parsed = JSON.parse(cleaned);

  if (!parsed.translations || !Array.isArray(parsed.translations)) {
    throw new Error('Invalid translation response: missing translations array');
  }

  return parsed.translations.map((t: any) => ({
    id: String(t.id || ''),
    translated: String(t.translated || ''),
  }));
}

// ─── TranslationBatcher ─────────────────────────────────────────────

export class TranslationBatcher {
  /**
   * Translate a batch of extracted texts using Google Gemini API directly.
   * Uses server-side GOOGLE_API_KEY — no user auth context needed.
   */
  async translateBatch(
    texts: ExtractedText[],
    options: TranslationOptions,
  ): Promise<Translation[]> {
    // Auto-detect source language if not provided
    const sourceLang = options.sourceLang || detectLanguage(texts.map((t) => t.text));
    const targetLang = options.targetLang;

    // Apply glossary first (direct replacements)
    const glossary = options.glossary || {};

    // Split into batches
    const batches: ExtractedText[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      batches.push(texts.slice(i, i + BATCH_SIZE));
    }

    const allTranslations: Translation[] = [];

    for (const batch of batches) {
      // Prepare batch items, applying glossary where possible
      const batchItems: Array<{ id: string; text: string }> = [];
      const glossaryTranslations: Translation[] = [];

      for (const text of batch) {
        // Check glossary first
        if (glossary[text.text]) {
          glossaryTranslations.push({
            confidence: 1,
            id: text.id,
            original: text.text,
            translated: glossary[text.text],
          });
        } else {
          batchItems.push({ id: text.id, text: text.text });
        }
      }

      // Add glossary results
      allTranslations.push(...glossaryTranslations);

      // Skip AI call if all texts were in glossary
      if (batchItems.length === 0) continue;

      // Call Gemini API directly
      const result = await this.callGeminiDirect(batchItems, sourceLang, targetLang);

      if (result) {
        allTranslations.push(...result);
      } else {
        // Fallback: keep original text
        for (const item of batchItems) {
          allTranslations.push({
            confidence: 0,
            id: item.id,
            original: item.text,
            translated: item.text,
          });
        }
      }
    }

    return allTranslations;
  }

  /**
   * Detect the source language of the extracted texts.
   */
  detectSourceLanguage(texts: ExtractedText[]): string {
    return detectLanguage(texts.map((t) => t.text));
  }

  /**
   * Call Google Gemini API directly using @google/genai SDK.
   * Falls back to fetch-based API call if SDK fails.
   */
  private async callGeminiDirect(
    batchItems: Array<{ id: string; text: string }>,
    sourceLang: string,
    targetLang: string,
  ): Promise<Translation[] | null> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error('[DocTranslation] GOOGLE_API_KEY not configured');
      return null;
    }

    const systemPrompt = buildSystemPrompt(sourceLang, targetLang);
    const userPrompt = buildBatchPrompt(batchItems);

    try {
      // Use @google/genai SDK
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContent({
        config: {
          responseMimeType: 'application/json',
          systemInstruction: systemPrompt,
          temperature: 0.2,
        },
        contents: [
          {
            parts: [{ text: userPrompt }],
            role: 'user',
          },
        ],
        model: 'gemini-2.5-flash',
      });

      const text = response.text;
      if (!text) {
        console.warn('[DocTranslation] Empty response from Gemini API');
        return null;
      }

      console.log(`[DocTranslation] Gemini response length: ${text.length} chars`);

      // Observe-only spend telemetry — this path bills the GOOGLE_API_KEY
      // directly (off-gateway), so it was invisible in every cost dashboard.
      // Fire-and-forget import keeps the posthog-server chain off the request path.
      const usage = (response as any).usageMetadata;
      void import('@/libs/posthog-server')
        .then(({ captureAiGeneration }) =>
          captureAiGeneration({
            costPoints: 0,
            feature: 'doc-translation',
            inputTokens:
              usage?.promptTokenCount ?? Math.ceil((systemPrompt.length + userPrompt.length) / 4),
            model: 'gemini-2.5-flash',
            outputTokens: usage?.candidatesTokenCount ?? Math.ceil(text.length / 4),
            provider: 'google-direct',
            userId: 'system',
          }),
        )
        .catch(() => {});

      const results = parseTranslationResponse(text);

      return results.map((result) => {
        const original = batchItems.find((b) => b.id === result.id);
        return {
          confidence: 0.9,
          id: result.id,
          original: original?.text || '',
          translated: result.translated,
        };
      });
    } catch (error) {
      console.error(
        '[DocTranslation] Gemini API error:',
        error instanceof Error ? error.message : error,
      );

      // Fallback: try with direct fetch to Gemini REST API
      try {
        return await this.callGeminiREST(apiKey, batchItems, sourceLang, targetLang);
      } catch (fallbackError) {
        console.error(
          '[DocTranslation] Gemini REST fallback failed:',
          fallbackError instanceof Error ? fallbackError.message : fallbackError,
        );
        return null;
      }
    }
  }

  /**
   * Direct REST API fallback for Gemini.
   */
  private async callGeminiREST(
    apiKey: string,
    batchItems: Array<{ id: string; text: string }>,
    sourceLang: string,
    targetLang: string,
  ): Promise<Translation[] | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: buildBatchPrompt(batchItems) }],
            role: 'user',
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
        systemInstruction: {
          parts: [{ text: buildSystemPrompt(sourceLang, targetLang) }],
        },
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Gemini REST API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.warn('[DocTranslation] Empty Gemini REST response');
      return null;
    }

    // Observe-only spend telemetry — direct GOOGLE_API_KEY path (off-gateway).
    // Fire-and-forget import keeps the posthog-server chain off the request path.
    const usage = data?.usageMetadata;
    void import('@/libs/posthog-server')
      .then(({ captureAiGeneration }) =>
        captureAiGeneration({
          costPoints: 0,
          feature: 'doc-translation',
          inputTokens:
            usage?.promptTokenCount ?? Math.ceil(buildBatchPrompt(batchItems).length / 4),
          model: 'gemini-2.0-flash',
          outputTokens: usage?.candidatesTokenCount ?? Math.ceil(text.length / 4),
          provider: 'google-direct',
          userId: 'system',
        }),
      )
      .catch(() => {});

    const results = parseTranslationResponse(text);

    return results.map((result) => {
      const original = batchItems.find((b) => b.id === result.id);
      return {
        confidence: 0.85,
        id: result.id,
        original: original?.text || '',
        translated: result.translated,
      };
    });
  }
}
