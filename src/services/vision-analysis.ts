/**
 * VisionAnalysisService — Interactive UI Phase 1
 *
 * Calls Vision AI (GPT-4o / Claude Vision / Gemini) with a structured-output
 * prompt to detect interactive regions in an image.  Returns an
 * `InteractiveRegions` object consumed by the InteractiveImage component.
 *
 * Usage:
 *   import { VisionAnalysisService } from '@/services/vision-analysis';
 *   const result = await VisionAnalysisService.analyzeImage(imageUrl, { context: 'chest X-ray' });
 *   if (result.success) render(result.data);
 *
 * Runs server-side only (uses initModelRuntimeWithUserPayload).
 */
import type {
  ImageType,
  InteractiveRegions,
  VisionAnalysisOptions,
  VisionAnalysisResult,
} from '@/components/InteractiveUI/types';

// ─── Constants ──────────────────────────────────────────────────────

/** Models in priority order — first available model wins */
const VISION_MODELS = [
  { model: 'openai/gpt-5.2', provider: 'vercelaigateway' },
  { model: 'anthropic/claude-sonnet-4.6', provider: 'vercelaigateway' },
  { model: 'google/gemini-2.5-flash', provider: 'vercelaigateway' },
  { model: 'openai/gpt-4o', provider: 'vercelaigateway' },
] as const;

const DEFAULT_MAX_REGIONS = 20;
const DEFAULT_LANGUAGE: VisionAnalysisOptions['preferredLanguage'] = 'vi';

// ─── Prompt Builder ─────────────────────────────────────────────────

function buildSystemPrompt(options: VisionAnalysisOptions): string {
  const lang = options.preferredLanguage ?? DEFAULT_LANGUAGE;
  const maxRegions = options.maxRegions ?? DEFAULT_MAX_REGIONS;
  const langInstruction =
    lang === 'vi'
      ? 'All labels, context, details values, and follow_ups MUST be in Vietnamese.'
      : 'All labels, context, details values, and follow_ups MUST be in English.';

  const imageTypeHint = options.imageTypeHint ? `The image is a ${options.imageTypeHint}. ` : '';

  return `You are a Vision AI specialized in analyzing images and detecting interactive regions.

${imageTypeHint}Analyze the provided image and return a JSON object matching this exact TypeScript interface:

interface InteractiveRegions {
  image_type: 'floor_plan' | 'anatomy' | 'cell_diagram' | 'molecule' | 'photo' | 'chart';
  context: string;
  regions: Array<{
    id: string;
    label: string;
    bounds: { x: number; y: number; w: number; h: number };
    color: string;
    details: Record<string, any>;
    follow_ups: string[];
  }>;
}

RULES:
1. image_type: classify the image into one of the 6 types above.
2. context: a brief description of what the image shows (1-2 sentences).
3. regions: detect up to ${maxRegions} meaningful, distinct regions in the image.
4. bounds: x, y, w, h are PERCENTAGES (0-100) relative to image dimensions.
   - x = left offset %, y = top offset %, w = width %, h = height %
   - Be precise — regions should tightly wrap the area of interest.
5. color: assign distinct hex colors for each region (e.g. #FF6B6B, #4ECDC4, #45B7D1).
   Use semantically meaningful colors when possible (red for danger, green for safe, etc.).
6. details: domain-specific key-value pairs. Examples:
   - Floor plan: { "area": "25m²", "function": "Phòng khách" }
   - Anatomy: { "organ": "Liver", "function": "Detoxification" }
   - Chart: { "value": "42%", "trend": "increasing" }
7. follow_ups: 2-3 natural follow-up questions a user might ask about this region.
8. id: use lowercase kebab-case (e.g. "living-room", "left-lung").
9. ${langInstruction}
10. Return ONLY the JSON object — no markdown, no code fences, no explanation.`;
}

function buildUserPrompt(options: VisionAnalysisOptions): string {
  const parts: string[] = ['Analyze this image and detect all interactive regions.'];

  if (options.context) {
    parts.push(`Additional context: ${options.context}`);
  }

  if (options.imageTypeHint) {
    parts.push(`This image is a ${options.imageTypeHint}.`);
  }

  return parts.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Extract text content from Server-Sent Events (SSE) format.
 * The chat API returns SSE with JSON delta chunks.
 */
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
      // Not JSON — might be raw text
      if (data && data !== '[DONE]') textParts.push(data);
    }
  }

  return textParts.join('');
}

/**
 * Consume a ReadableStream (or Response) and return the full text.
 * Handles both streaming and non-streaming runtime responses.
 */
async function streamToText(response: any): Promise<string> {
  // If it's already a string
  if (typeof response === 'string') return response;

  // If it's a Response object with body stream
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

    // Parse SSE format: extract content from "data: {...}" lines
    const raw = chunks.join('');
    return extractContentFromSSE(raw);
  }

  // Fallback: try to stringify
  return String(response || '');
}

// ─── JSON Parser ────────────────────────────────────────────────────

const VALID_IMAGE_TYPES: Set<string> = new Set([
  'anatomy',
  'cell_diagram',
  'chart',
  'floor_plan',
  'molecule',
  'photo',
]);

/**
 * Parse and validate the AI response into InteractiveRegions.
 * Handles common AI quirks: markdown code fences, extra text, etc.
 */
function parseResponse(raw: string): InteractiveRegions {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Find the JSON object boundaries
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object found in response');
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  const parsed = JSON.parse(cleaned);

  // Validate required fields
  if (!parsed.image_type || !Array.isArray(parsed.regions)) {
    throw new Error('Missing required fields: image_type, regions');
  }

  if (!VALID_IMAGE_TYPES.has(parsed.image_type)) {
    // Coerce to closest match or default to 'photo'
    parsed.image_type = 'photo';
  }

  // Validate and sanitize each region
  parsed.regions = parsed.regions
    .filter((r: any) => r && r.id && r.label && r.bounds)
    .map((r: any) => ({
      bounds: {
        h: clamp(Number(r.bounds.h) || 10, 1, 100),
        w: clamp(Number(r.bounds.w) || 10, 1, 100),
        x: clamp(Number(r.bounds.x) || 0, 0, 100),
        y: clamp(Number(r.bounds.y) || 0, 0, 100),
      },
      color: typeof r.color === 'string' && r.color.startsWith('#') ? r.color : '#4ECDC4',
      details: typeof r.details === 'object' && r.details !== null ? r.details : {},
      follow_ups: Array.isArray(r.follow_ups)
        ? r.follow_ups.filter((q: any) => typeof q === 'string').slice(0, 5)
        : [],
      id: String(r.id),
      label: String(r.label),
    }));

  return {
    context: String(parsed.context || ''),
    image_type: parsed.image_type as ImageType,
    regions: parsed.regions,
  };
}

// ─── Service ────────────────────────────────────────────────────────

export const VisionAnalysisService = {
  /**
   * Analyze an image and detect interactive regions using Vision AI.
   *
   * @param imageUrl - Public URL or base64 data-URI of the image.
   * @param options  - Analysis configuration.
   * @returns        - Structured result with regions or error info.
   */
  async analyzeImage(
    imageUrl: string,
    options: VisionAnalysisOptions = {},
    /** Authenticated user id for cost attribution (PostHog + gateway tags). */
    userId?: string,
  ): Promise<VisionAnalysisResult> {
    const { initModelRuntimeWithUserPayload } = await import('@/server/modules/ModelRuntime');

    const promptChars = buildSystemPrompt(options).length + buildUserPrompt(options).length;

    for (const { model, provider } of VISION_MODELS) {
      try {
        const startAt = Date.now();
        const runtime = await initModelRuntimeWithUserPayload(provider, {});

        // Build the chat completion request with image
        const response = await runtime.chat(
          {
            messages: [
              {
                content: buildSystemPrompt(options),
                role: 'system',
              },
              {
                content: [
                  { text: buildUserPrompt(options), type: 'text' },
                  { image_url: { detail: 'high', url: imageUrl }, type: 'image_url' },
                ],
                role: 'user',
              },
            ],
            model,
            temperature: 0.2, // Low temperature for structured output
          },
          {
            tags: ['feature:vision'],
            user: userId,
          },
        );

        // Extract text from the streaming response
        const text = await streamToText(response);

        if (!text) {
          console.warn(`[VisionAnalysis] Empty response from ${model}, trying next model`);
          continue;
        }

        // Observe-only spend telemetry (no point deduction yet — cost-audit WS2-2d).
        // Fire-and-forget import: keeps the posthog-server module chain (DB deps)
        // off this request's critical path. Token counts are text-only estimates;
        // image input tokens are NOT included.
        const latencyMs = Date.now() - startAt;
        void import('@/libs/posthog-server')
          .then(({ captureAiGeneration }) =>
            captureAiGeneration({
              costPoints: 0,
              feature: 'vision',
              inputTokens: Math.ceil(promptChars / 4),
              latencyMs,
              model,
              outputTokens: Math.ceil(text.length / 4),
              provider,
              userId: userId || 'anonymous',
            }),
          )
          .catch(() => {});

        const data = parseResponse(text);

        return {
          data,
          model,
          success: true,
        };
      } catch (error) {
        console.warn(
          `[VisionAnalysis] ${model} failed:`,
          error instanceof Error ? error.message : error,
        );
        continue;
      }
    }

    return {
      data: null,
      error: 'All vision models failed to analyze the image.',
      model: 'none',
      success: false,
    };
  },

  /**
   * Validate that a URL is suitable for vision analysis.
   * Accepts https URLs and base64 data-URIs.
   */
  isValidImageSource(src: string): boolean {
    if (!src) return false;
    if (src.startsWith('data:image/')) return true;
    try {
      const url = new URL(src);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  },
};
