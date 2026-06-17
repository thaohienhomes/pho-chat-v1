/**
 * Agent 5: QualityValidator
 * 4-stage quality pipeline with retry loop (max 3 attempts).
 * Orchestrates: syntax → spatial → content scoring → render test.
 *
 * Critical for reliability — PRD target: 98% success rate by attempt 3.
 */
import type { GeneratedCode } from '../types/generated-code';
import type { Storyboard } from '../types/storyboard';
import { type LlmCallFn, scoreContent } from '../validators/content-scorer';
import { validateRender } from '../validators/render-tester';
import { validateSpatial } from '../validators/spatial-validator';
import { validateSyntax } from '../validators/syntax-validator';
import { generateReactArtifact, generateReactArtifactWithRetry } from './react-artifact-generator';

/** Maximum retry attempts per PRD section 2.5. */
const MAX_ATTEMPTS = 3;

export interface ValidationStageResult {
  errors: string[];
  stage: 'content' | 'render' | 'spatial' | 'syntax';
  valid: boolean;
  warnings?: string[];
}

export interface ValidationResult {
  attempts: number;
  code: GeneratedCode;
  stages: ValidationStageResult[];
  success: boolean;
}

/**
 * Fallback static artifact when all 3 attempts fail.
 * Returns a simple text explanation instead of interactive visualization.
 */
function createFallbackArtifact(storyboard: Storyboard): GeneratedCode {
  const narration = storyboard.scenes.map((s) => s.narration).join('\n\n');
  const fallbackCode = `import React from 'react';

export default function ContentVisualization() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-8 text-slate-100">
      <div className="max-w-2xl rounded-xl bg-slate-900 p-8">
        <h1 className="mb-4 text-2xl font-bold">
          ${storyboard.scenes[0]?.title || 'Visualization'}
        </h1>
        <div className="space-y-4 text-slate-300">
          ${storyboard.scenes
            .map(
              (s) =>
                `<div>
            <h2 className="mb-2 text-lg font-semibold text-slate-100">${s.title}</h2>
            <p>${s.narration}</p>
          </div>`,
            )
            .join('\n          ')}
        </div>
        <p className="mt-6 text-sm text-slate-500">
          Interactive visualization could not be generated. Showing text summary.
        </p>
      </div>
    </div>
  );
}`;

  return {
    code: fallbackCode,
    conceptId: storyboard.conceptId,
    dependencies: ['react', 'tailwindcss'],
    estimatedRenderTime: 0.5,
    language: 'jsx',
    narrationScript: narration,
    track: 'artifact',
  };
}

/**
 * Run 4-stage validation pipeline on generated code.
 *
 * @param code - GeneratedCode to validate
 * @returns Array of stage results
 */
export function runValidationPipeline(code: GeneratedCode): {
  allErrors: string[];
  stages: ValidationStageResult[];
} {
  const stages: ValidationStageResult[] = [];
  const allErrors: string[] = [];

  // Stage 1: Syntax validation
  const syntaxResult = validateSyntax(code.code);
  stages.push({
    errors: syntaxResult.errors,
    stage: 'syntax',
    valid: syntaxResult.valid,
  });
  allErrors.push(...syntaxResult.errors);

  // Stage 2: Spatial validation
  const spatialResult = validateSpatial(code.code);
  stages.push({
    errors: spatialResult.errors,
    stage: 'spatial',
    valid: spatialResult.valid,
    warnings: spatialResult.warnings,
  });
  allErrors.push(...spatialResult.errors);

  // Stage 3: Content scoring (heuristic only in sync pipeline)
  // LLM judge is async and handled separately if needed
  const heuristicDetails: string[] = [];
  const heuristicErrors: string[] = [];

  // Quick heuristic checks from content-scorer
  const hasDefaultExport = /export\s+default\s+/.test(code.code);
  if (!hasDefaultExport) {
    heuristicErrors.push('No default export found.');
  }

  stages.push({
    errors: heuristicErrors,
    stage: 'content',
    valid: heuristicErrors.length === 0,
    warnings: heuristicDetails,
  });
  allErrors.push(...heuristicErrors);

  // Stage 4: Render test
  const renderResult = validateRender(code.code);
  stages.push({
    errors: renderResult.errors,
    stage: 'render',
    valid: renderResult.valid,
    warnings: renderResult.warnings,
  });
  allErrors.push(...renderResult.errors);

  return { allErrors, stages };
}

/**
 * Run async validation pipeline including LLM judge for content scoring.
 */
async function runAsyncContentScoring(
  code: GeneratedCode,
  llmCall?: LlmCallFn,
): Promise<ValidationStageResult> {
  const result = await scoreContent(code.code, code.narrationScript, llmCall);

  return {
    errors: result.errors,
    stage: 'content',
    valid: result.valid,
    warnings: result.details,
  };
}

/**
 * Validate and retry code generation for a single storyboard.
 * Implements the 3-attempt retry loop from PRD section 2.5.
 *
 * @param storyboard - Storyboard from Agent 3
 * @param llmCall - LLM function for code generation and quality judging
 * @param useAsyncScoring - Whether to use async LLM judge for content scoring
 * @returns ValidationResult with final code and attempt count
 */
export async function validateWithRetry(
  storyboard: Storyboard,
  llmCall: LlmCallFn,
  useAsyncScoring = false,
): Promise<ValidationResult> {
  let code: GeneratedCode | null = null;
  let lastStages: ValidationStageResult[] = [];
  let accumulatedErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Generate code
    if (attempt === 1) {
      code = await generateReactArtifact(storyboard, llmCall);
    } else {
      code = await generateReactArtifactWithRetry(storyboard, accumulatedErrors, attempt, llmCall);
    }

    // Run validation pipeline
    const { allErrors, stages } = runValidationPipeline(code);
    lastStages = stages;

    // Optionally run async content scoring with LLM judge
    if (useAsyncScoring) {
      const asyncContentResult = await runAsyncContentScoring(code, llmCall);
      // Replace the sync content stage with async result
      const contentIdx = lastStages.findIndex((s) => s.stage === 'content');
      if (contentIdx !== -1) {
        lastStages[contentIdx] = asyncContentResult;
        // Update errors
        const syncContentErrors = lastStages[contentIdx].errors;
        const filtered = allErrors.filter((e) => !syncContentErrors.includes(e));
        allErrors.length = 0;
        allErrors.push(...filtered, ...asyncContentResult.errors);
      }
    }

    // Check if all stages passed
    const allPassed = lastStages.every((s) => s.valid);
    if (allPassed) {
      return {
        attempts: attempt,
        code,
        stages: lastStages,
        success: true,
      };
    }

    // Accumulate errors for next retry
    accumulatedErrors = [...new Set([...accumulatedErrors, ...allErrors])];
  }

  // All attempts failed — return fallback
  return {
    attempts: MAX_ATTEMPTS,
    code: createFallbackArtifact(storyboard),
    stages: lastStages,
    success: false,
  };
}

/**
 * Run QualityValidator on all generated code results.
 *
 * @param storyboards - Storyboards from Agent 3
 * @param llmCall - LLM function
 * @param useAsyncScoring - Whether to use LLM judge
 * @returns Array of ValidationResults
 */
export async function runQualityValidator(
  storyboards: Storyboard[],
  llmCall: LlmCallFn,
  useAsyncScoring = false,
): Promise<ValidationResult[]> {
  const artifactStoryboards = storyboards.filter(
    (sb) => sb.renderTrack === 'artifact' || sb.renderTrack === 'both',
  );

  const results: ValidationResult[] = [];
  for (const storyboard of artifactStoryboards) {
    const result = await validateWithRetry(storyboard, llmCall, useAsyncScoring);
    results.push(result);
  }

  return results;
}
