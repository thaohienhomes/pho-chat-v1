/**
 * Stage 3: Content Quality Scoring
 * Heuristic rules (fast, automated) + LLM judge (optional, accurate).
 * Validates pedagogical quality, accuracy, and engagement.
 */

export type LlmCallFn = (systemPrompt: string, userMessage: string) => Promise<string>;

export interface ContentScore {
  accuracy: number;
  engagement: number;
  overall: number;
  pedagogical: number;
}

export interface ContentScoringResult {
  details: string[];
  errors: string[];
  score: ContentScore;
  valid: boolean;
}

/** Minimum average score threshold (PRD section 2.5). */
const SCORE_THRESHOLD = 7;

/**
 * BANNED narration phrases — same as VisualizationPlanner.
 */
const BANNED_PHRASES = [
  'now we display',
  'watch as',
  "let's see",
  'as shown above',
  'in this diagram',
  'the figure shows',
  'the diagram shows',
  'as we can see',
  'looking at the',
  'as illustrated',
];

/**
 * System prompt for LLM quality judge.
 */
const LLM_JUDGE_PROMPT = `You are a quality judge for educational visualizations in Pho.Chat.
Evaluate the given React component code and narration script for:

1. Pedagogical quality (1-10): Would a high school student understand the concept better?
2. Accuracy (1-10): Does the visualization accurately represent the source material?
3. Engagement (1-10): Is it interactive enough to hold attention?

Output JSON: { "pedagogical": N, "accuracy": N, "engagement": N, "feedback": "..." }
No markdown fences. Just the JSON object.`;

/**
 * Heuristic: Check for banned narration phrases in code.
 */
function checkBannedPhrases(code: string): string[] {
  const errors: string[] = [];
  const lower = code.toLowerCase();

  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      errors.push(`Contains banned narration phrase: "${phrase}".`);
    }
  }

  return errors;
}

/**
 * Heuristic: Check that code includes labels/annotations.
 */
function checkLabelsAndAnnotations(code: string): string[] {
  const details: string[] = [];

  // Check for aria-label usage
  const ariaCount = (code.match(/aria-label/g) || []).length;
  if (ariaCount < 2) {
    details.push('Few ARIA labels detected. Add aria-label to interactive elements.');
  }

  // Check for text labels in SVG or DOM
  const hasLabels =
    /<text[\s>]/.test(code) ||
    /<label[\s>]/.test(code) ||
    /<h[1-6][\s>]/.test(code) ||
    /<p[\s>]/.test(code) ||
    /className=.*text-/.test(code);

  if (!hasLabels) {
    details.push('No visible text labels found. Visualization should include labels/annotations.');
  }

  return details;
}

/**
 * Heuristic: Check for interactive elements with detail content.
 */
function checkInteractivity(code: string): string[] {
  const details: string[] = [];

  const hasOnClick = /onClick/.test(code);
  const hasOnHover = /onMouse(?:Enter|Over|Leave)/.test(code);
  const hasSelectedState = /selectedElement|selected/.test(code);

  if (!hasOnClick && !hasOnHover) {
    details.push('No click/hover handlers found. Add interactive elements for engagement.');
  }

  if (hasOnClick && !hasSelectedState) {
    details.push('Click handlers exist but no selection state. Add detail panel on click.');
  }

  return details;
}

/**
 * Heuristic: Check scene count (should be 2-8 per PRD section 2.5).
 */
function checkSceneStructure(code: string): string[] {
  const errors: string[] = [];

  // Count scene-like structures (switch cases, array entries, conditional renders)
  const scenePatterns = [
    /case\s+\d+\s*:/g,
    /sceneNumber\s*[:=]\s*\d+/g,
    /scene\s*===?\s*\d+/g,
    /currentScene\s*===?\s*\d+/g,
  ];

  let maxSceneCount = 0;
  for (const pattern of scenePatterns) {
    const matches = code.match(pattern) || [];
    maxSceneCount = Math.max(maxSceneCount, matches.length);
  }

  if (maxSceneCount > 0 && maxSceneCount < 2) {
    errors.push(`Only ${maxSceneCount} scene detected. Minimum 2 scenes required.`);
  } else if (maxSceneCount > 8) {
    errors.push(`${maxSceneCount} scenes detected. Maximum 8 scenes recommended.`);
  }

  return errors;
}

/**
 * Run heuristic scoring (fast, automated).
 * Returns a score based on code quality indicators.
 */
function heuristicScore(code: string): {
  details: string[];
  errors: string[];
  score: ContentScore;
} {
  const errors: string[] = [];
  const details: string[] = [];

  // Banned phrases
  errors.push(...checkBannedPhrases(code));

  // Labels and interactivity
  details.push(...checkLabelsAndAnnotations(code), ...checkInteractivity(code));

  // Scene structure
  errors.push(...checkSceneStructure(code));

  // Score based on heuristics
  let pedagogical = 8;
  let accuracy = 8;
  let engagement = 8;

  // Deduct for errors
  pedagogical -= errors.length * 1.5;
  accuracy -= errors.filter((e) => e.includes('banned')).length * 2;

  // Deduct for missing features
  engagement -= details.filter((d) => d.includes('interactive') || d.includes('click')).length;
  pedagogical -= details.filter((d) => d.includes('label') || d.includes('ARIA')).length * 0.5;

  // Clamp to 1-10
  pedagogical = Math.max(1, Math.min(10, Math.round(pedagogical)));
  accuracy = Math.max(1, Math.min(10, Math.round(accuracy)));
  engagement = Math.max(1, Math.min(10, Math.round(engagement)));

  const overall = Math.round((pedagogical + accuracy + engagement) / 3);

  return {
    details,
    errors,
    score: { accuracy, engagement, overall, pedagogical },
  };
}

/**
 * Parse LLM judge response.
 */
function parseLlmJudgeResponse(response: string): {
  accuracy: number;
  engagement: number;
  feedback: string;
  pedagogical: number;
} | null {
  try {
    const cleaned = response
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Score content quality using heuristics and optionally LLM judge.
 *
 * @param code - Generated JSX code
 * @param narrationScript - Optional narration text for the visualization
 * @param llmCall - Optional LLM function for deeper quality scoring
 * @returns ContentScoringResult with combined score
 */
export async function scoreContent(
  code: string,
  narrationScript?: string,
  llmCall?: LlmCallFn,
): Promise<ContentScoringResult> {
  // Stage 1: Heuristic scoring (always runs)
  const heuristic = heuristicScore(code);

  // Stage 2: LLM judge (optional, runs if llmCall provided)
  if (llmCall) {
    try {
      const userMessage = `## Code to Evaluate

\`\`\`jsx
${code.slice(0, 3000)}
\`\`\`

${narrationScript ? `## Narration Script\n${narrationScript.slice(0, 1000)}` : ''}`;

      const response = await llmCall(LLM_JUDGE_PROMPT, userMessage);
      const judgeResult = parseLlmJudgeResponse(response);

      if (judgeResult) {
        // Blend heuristic (40%) + LLM judge (60%) scores
        const blended: ContentScore = {
          accuracy: Math.round(heuristic.score.accuracy * 0.4 + judgeResult.accuracy * 0.6),
          engagement: Math.round(heuristic.score.engagement * 0.4 + judgeResult.engagement * 0.6),
          overall: 0,
          pedagogical: Math.round(
            heuristic.score.pedagogical * 0.4 + judgeResult.pedagogical * 0.6,
          ),
        };
        blended.overall = Math.round(
          (blended.pedagogical + blended.accuracy + blended.engagement) / 3,
        );

        if (judgeResult.feedback) {
          heuristic.details.push(`LLM Judge: ${judgeResult.feedback}`);
        }

        return {
          details: heuristic.details,
          errors: heuristic.errors,
          score: blended,
          valid: blended.overall >= SCORE_THRESHOLD,
        };
      }
    } catch {
      // LLM judge failed — fall back to heuristic only
      heuristic.details.push('LLM judge unavailable, using heuristic score only.');
    }
  }

  return {
    details: heuristic.details,
    errors: heuristic.errors,
    score: heuristic.score,
    valid: heuristic.score.overall >= SCORE_THRESHOLD,
  };
}
