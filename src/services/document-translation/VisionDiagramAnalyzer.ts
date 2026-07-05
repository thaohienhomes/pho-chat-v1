/**
 * VisionDiagramAnalyzer — Route B for embedded image diagrams
 *
 * When DOCX diagrams are embedded as images (not native shapes),
 * this service uses Vision AI to:
 * 1. Detect text regions in the image
 * 2. Extract text via OCR
 * 3. Return text positions for translation overlay
 *
 * Uses the same multi-model fallback pattern as vision-analysis.ts
 */
import type { ExtractedText } from './types';

// ─── Constants ──────────────────────────────────────────────────────

/** Vision models ordered by OCR quality for diagram text detection */
const VISION_MODELS = [
  { model: 'google/gemini-2.5-flash', provider: 'vercelaigateway' },
  { model: 'openai/gpt-5.2', provider: 'vercelaigateway' },
  { model: 'anthropic/claude-sonnet-4.6', provider: 'vercelaigateway' },
] as const;

// ─── Prompt ─────────────────────────────────────────────────────────

function buildDiagramOCRPrompt(): string {
  return `You are a specialized OCR system for technical diagrams, flowcharts, and engineering drawings in Word documents.

Analyze the provided image and extract ALL visible text labels, annotations, and captions.

Return a JSON object:
{
  "texts": [
    {
      "id": "text-1",
      "text": "exact text content",
      "type": "label" | "annotation" | "caption" | "title" | "connector",
      "bounds": { "x": 10, "y": 20, "w": 15, "h": 5 },
      "confidence": 0.95
    }
  ],
  "diagramType": "flowchart" | "org_chart" | "floor_plan" | "technical_drawing" | "process_diagram" | "other",
  "context": "Brief description of what this diagram shows"
}

RULES:
1. bounds: x, y, w, h are PERCENTAGES (0-100) relative to image dimensions
2. Extract EVERY piece of text, no matter how small
3. Preserve exact text including numbers, abbreviations, and symbols
4. confidence: how confident you are that the OCR is correct (0-1)
5. type: classify each text's role in the diagram
6. Return ONLY the JSON object — no markdown, no code fences`;
}

// ─── SSE/Stream helpers (same pattern as vision-analysis.ts) ────────

function extractContentFromSSE(raw: string): string {
  const lines = raw.split('\n');
  const textParts: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') break;
    try {
      const parsed = JSON.parse(data);
      const content = parsed.choices?.[0]?.delta?.content;
      if (content) textParts.push(content);
    } catch {
      if (data && data !== '[DONE]') textParts.push(data);
    }
  }
  return textParts.join('');
}

async function streamToText(response: any): Promise<string> {
  if (typeof response === 'string') return response;
  if (response instanceof Response) {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (done) break;
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    return extractContentFromSSE(chunks.join(''));
  }
  return String(response || '');
}

// ─── Response Parser ────────────────────────────────────────────────

interface VisionOCRResult {
  context: string;
  diagramType: string;
  texts: Array<{
    bounds: { h: number; w: number; x: number; y: number };
    confidence: number;
    id: string;
    text: string;
    type: string;
  }>;
}

function parseOCRResponse(raw: string): VisionOCRResult {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object found in Vision AI OCR response');
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  const parsed = JSON.parse(cleaned);
  if (!parsed.texts || !Array.isArray(parsed.texts)) {
    throw new Error('Invalid OCR response: missing texts array');
  }

  return parsed as VisionOCRResult;
}

// ─── VisionDiagramAnalyzer ──────────────────────────────────────────

export class VisionDiagramAnalyzer {
  /**
   * Analyze an embedded diagram image and extract text using Vision AI.
   *
   * @param imageBase64 - Base64 encoded image data
   * @param mimeType - Image MIME type (e.g., 'image/png', 'image/jpeg')
   * @returns Extracted texts formatted as ExtractedText[]
   */
  async analyzeImage(
    imageBase64: string,
    mimeType: string = 'image/png',
    /** User id for cost attribution when the pipeline has one; defaults to 'system'. */
    userId?: string,
  ): Promise<{
    context: string;
    diagramType: string;
    texts: ExtractedText[];
  }> {
    const { initModelRuntimeWithUserPayload } = await import('@/server/modules/ModelRuntime');

    for (const { model, provider } of VISION_MODELS) {
      try {
        const startAt = Date.now();
        const runtime = await initModelRuntimeWithUserPayload(provider, {});

        const imageUrl = `data:${mimeType};base64,${imageBase64}`;

        const response = await runtime.chat(
          {
            messages: [
              {
                content: buildDiagramOCRPrompt(),
                role: 'system' as const,
              },
              {
                content: [
                  {
                    image_url: { detail: 'high', url: imageUrl },
                    type: 'image_url',
                  },
                  {
                    text: 'Extract all text from this diagram. Return JSON with the text positions.',
                    type: 'text',
                  },
                ] as any,
                role: 'user' as const,
              },
            ],
            model,
            temperature: 0.1,
          },
          {
            tags: ['feature:doc-translation-ocr'],
            user: userId,
          },
        );

        const text = await streamToText(response);
        if (!text) {
          console.warn(`[VisionDiagram] Empty response from ${model}, trying next`);
          continue;
        }

        // Observe-only spend telemetry (no point deduction yet — cost-audit WS2-2d).
        // Fire-and-forget import keeps the posthog-server module chain off the
        // request path. Token counts are text-only estimates; image input tokens
        // are NOT included.
        const latencyMs = Date.now() - startAt;
        void import('@/libs/posthog-server')
          .then(({ captureAiGeneration }) =>
            captureAiGeneration({
              costPoints: 0,
              feature: 'doc-translation-ocr',
              inputTokens: Math.ceil(buildDiagramOCRPrompt().length / 4),
              latencyMs,
              model,
              outputTokens: Math.ceil(text.length / 4),
              provider,
              userId: userId || 'system',
            }),
          )
          .catch(() => {});

        const result = parseOCRResponse(text);

        // Convert to ExtractedText format
        const extractedTexts: ExtractedText[] = result.texts.map((t, i) => ({
          elementIndex: i,
          id: `vision-${t.id || i}`,
          metadata: {
            position: {
              height: t.bounds.h,
              width: t.bounds.w,
              x: t.bounds.x,
              y: t.bounds.y,
            },
          },
          text: t.text,
          type: 'drawingml' as const,
          xmlPath: 'vision-ai-ocr',
        }));

        return {
          context: result.context,
          diagramType: result.diagramType,
          texts: extractedTexts,
        };
      } catch (error) {
        console.warn(
          `[VisionDiagram] ${model} failed:`,
          error instanceof Error ? error.message : error,
        );
        continue;
      }
    }

    // All models failed
    return {
      context: 'Vision AI could not analyze this diagram',
      diagramType: 'unknown',
      texts: [],
    };
  }

  /**
   * Extract embedded images from a DOCX ZIP file.
   *
   * @param zip - JSZip instance of the DOCX
   * @returns Array of { path, base64, mimeType }
   */
  async extractEmbeddedImages(
    zip: any, // JSZip
  ): Promise<Array<{ base64: string; mimeType: string; path: string }>> {
    const imagePaths = Object.keys(zip.files).filter(
      (name) =>
        name.startsWith('word/media/') &&
        (name.endsWith('.png') ||
          name.endsWith('.jpg') ||
          name.endsWith('.jpeg') ||
          name.endsWith('.gif') ||
          name.endsWith('.emf') ||
          name.endsWith('.wmf')),
    );

    const images: Array<{ base64: string; mimeType: string; path: string }> = [];

    for (const path of imagePaths) {
      const file = zip.file(path);
      if (!file) continue;

      const data = await file.async('base64');
      const ext = path.split('.').pop()?.toLowerCase() || 'png';
      const mimeMap: Record<string, string> = {
        emf: 'image/x-emf',
        gif: 'image/gif',
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        png: 'image/png',
        wmf: 'image/x-wmf',
      };

      images.push({
        base64: data,
        mimeType: mimeMap[ext] || 'image/png',
        path,
      });
    }

    return images;
  }
}
