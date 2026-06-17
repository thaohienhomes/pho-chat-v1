import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAssemblyOrchestrator } from './agents/assembly-orchestrator';
import { runConceptAnalyzer } from './agents/concept-analyzer';
import { runContentIngestion } from './agents/content-ingestion';
import { runQualityValidator } from './agents/quality-validator';
import { runVisualizationPlanner } from './agents/visualization-planner';
import type { LlmCallFn, PipelineInput, PipelineStage } from './pipeline';
import { runPipeline } from './pipeline';

// ---------------------------------------------------------------------------
// Mock all agents
// ---------------------------------------------------------------------------

vi.mock('./agents/content-ingestion', () => ({
  runContentIngestion: vi.fn(),
}));

vi.mock('./agents/concept-analyzer', () => ({
  runConceptAnalyzer: vi.fn(),
}));

vi.mock('./agents/visualization-planner', () => ({
  runVisualizationPlanner: vi.fn(),
}));

vi.mock('./agents/quality-validator', () => ({
  runQualityValidator: vi.fn(),
}));

vi.mock('./agents/assembly-orchestrator', () => ({
  runAssemblyOrchestrator: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockParsedContent = {
  metadata: {
    difficulty: 'intermediate' as const,
    language: 'en',
    source: 'text' as const,
    title: 'Test Content',
  },
  sections: [
    {
      content: 'Section 1 content',
      equations: [],
      figures: [],
      id: 's1',
      tables: [],
      title: 'Section 1',
    },
  ],
};

const mockConceptMaps = [
  {
    concepts: [
      {
        description: 'A concept',
        id: 'c1',
        renderTrack: 'artifact' as const,
        scores: { complexity: 8, feasibility: 8, interactivityValue: 8, visualBenefit: 8 },
        sourceText: 'Source',
        title: 'Concept 1',
        vizType: 'structural_diagram' as const,
      },
    ],
    sectionId: 's1',
  },
];

const mockStoryboards = [
  {
    conceptId: 'c1',
    estimatedDuration: 30,
    language: 'en' as const,
    renderTrack: 'artifact' as const,
    scenes: [
      {
        narration: 'The key insight is...',
        purpose: 'Introduce',
        sceneNumber: 1,
        title: 'Intro',
        visualElements: [
          {
            description: 'Shape',
            position: { x: 50, y: 50 },
            timing: { duration: 2, start: 0 },
            type: 'shape' as const,
          },
        ],
      },
    ],
    targetAudience: 'undergraduate' as const,
  },
];

const mockValidationResults = [
  {
    attempts: 1,
    code: {
      code: 'export default function Viz() { return <div>Viz</div>; }',
      conceptId: 'c1',
      dependencies: ['react'],
      estimatedRenderTime: 1,
      language: 'jsx' as const,
      narrationScript: 'The key insight is...',
      track: 'artifact' as const,
    },
    stages: [],
    success: true,
  },
];

const mockArtifact = {
  layout: 'scrollytelling' as const,
  metadata: mockParsedContent.metadata,
  sections: [
    {
      contentHtml: '<p>Section 1 content</p>',
      sectionId: 's1',
      title: 'Section 1',
      visualizations: [
        {
          artifactCode: 'export default function Viz() { return <div>Viz</div>; }',
          conceptId: 'c1',
          isInteractive: true,
        },
      ],
    },
  ],
};

function setupMocks() {
  (runContentIngestion as ReturnType<typeof vi.fn>).mockResolvedValue(mockParsedContent);
  (runConceptAnalyzer as ReturnType<typeof vi.fn>).mockResolvedValue(mockConceptMaps);
  (runVisualizationPlanner as ReturnType<typeof vi.fn>).mockResolvedValue(mockStoryboards);
  (runQualityValidator as ReturnType<typeof vi.fn>).mockResolvedValue(mockValidationResults);
  (runAssemblyOrchestrator as ReturnType<typeof vi.fn>).mockReturnValue(mockArtifact);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pipeline Orchestrator', () => {
  let mockLlm: LlmCallFn;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLlm = vi.fn();
    setupMocks();
  });

  // --------------------------------
  // End-to-end flow
  // --------------------------------
  describe('runPipeline', () => {
    it('executes all pipeline stages in order', async () => {
      const input: PipelineInput = { text: 'Some educational content' };

      await runPipeline(input, mockLlm);

      expect(runContentIngestion).toHaveBeenCalledTimes(1);
      expect(runConceptAnalyzer).toHaveBeenCalledTimes(1);
      expect(runVisualizationPlanner).toHaveBeenCalledTimes(1);
      expect(runQualityValidator).toHaveBeenCalledTimes(1);
      expect(runAssemblyOrchestrator).toHaveBeenCalledTimes(1);
    });

    it('passes correct data between stages', async () => {
      const input: PipelineInput = { text: 'Content' };

      await runPipeline(input, mockLlm);

      // ContentIngestion receives the input
      expect(runContentIngestion).toHaveBeenCalledWith(input, mockLlm);

      // ConceptAnalyzer receives parsed content
      expect(runConceptAnalyzer).toHaveBeenCalledWith(mockParsedContent, mockLlm);

      // VisualizationPlanner receives concept maps + language + difficulty
      expect(runVisualizationPlanner).toHaveBeenCalledWith(
        mockConceptMaps,
        'en',
        'intermediate',
        mockLlm,
      );

      // QualityValidator receives storyboards
      expect(runQualityValidator).toHaveBeenCalledWith(mockStoryboards, mockLlm, undefined);

      // AssemblyOrchestrator receives combined data
      expect(runAssemblyOrchestrator).toHaveBeenCalledWith(
        expect.objectContaining({
          codeResults: [mockValidationResults[0].code],
          conceptMaps: mockConceptMaps,
          parsedContent: mockParsedContent,
        }),
      );
    });

    it('returns complete pipeline output with intermediate results', async () => {
      const input: PipelineInput = { text: 'Content' };

      const result = await runPipeline(input, mockLlm);

      expect(result.parsedContent).toEqual(mockParsedContent);
      expect(result.conceptMaps).toEqual(mockConceptMaps);
      expect(result.storyboards).toEqual(mockStoryboards);
      expect(result.codeResults).toEqual([mockValidationResults[0].code]);
      expect(result.artifact).toEqual(mockArtifact);
    });

    it('passes useAsyncScoring option to quality validator', async () => {
      const input: PipelineInput = { text: 'Content', useAsyncScoring: true };

      await runPipeline(input, mockLlm);

      expect(runQualityValidator).toHaveBeenCalledWith(mockStoryboards, mockLlm, true);
    });

    it('uses language from input when metadata does not provide it', async () => {
      const contentWithoutLang = {
        ...mockParsedContent,
        metadata: { ...mockParsedContent.metadata, language: '' },
      };
      (runContentIngestion as ReturnType<typeof vi.fn>).mockResolvedValue(contentWithoutLang);

      const input: PipelineInput = { language: 'vi', text: 'Content' };
      await runPipeline(input, mockLlm);

      expect(runVisualizationPlanner).toHaveBeenCalledWith(
        mockConceptMaps,
        'vi',
        'intermediate',
        mockLlm,
      );
    });
  });

  // --------------------------------
  // Progress callbacks
  // --------------------------------
  describe('progress callbacks', () => {
    it('calls progress callback at each stage', async () => {
      const onProgress = vi.fn();
      const input: PipelineInput = { text: 'Content' };

      await runPipeline(input, mockLlm, onProgress);

      const calls = onProgress.mock.calls;
      const stages = calls.map(([stage]: any[]) => stage as PipelineStage);

      expect(stages).toContain('ingestion');
      expect(stages).toContain('analysis');
      expect(stages).toContain('planning');
      expect(stages).toContain('validating');
      expect(stages).toContain('assembling');
    });

    it('reports progress percentages in increasing order', async () => {
      const onProgress = vi.fn();
      const input: PipelineInput = { text: 'Content' };

      await runPipeline(input, mockLlm, onProgress);

      const percents = onProgress.mock.calls.map(([, pct]: any[]) => pct as number);

      // Each percent should be >= the previous
      for (let i = 1; i < percents.length; i++) {
        expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
      }

      // Final should be 100
      expect(percents.at(-1)).toBe(100);
    });

    it('works without progress callback (optional)', async () => {
      const input: PipelineInput = { text: 'Content' };

      // Should not throw
      const result = await runPipeline(input, mockLlm);

      expect(result.artifact).toBeDefined();
    });
  });

  // --------------------------------
  // Error handling
  // --------------------------------
  describe('error propagation', () => {
    it('propagates content ingestion errors', async () => {
      (runContentIngestion as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to fetch'),
      );

      const input: PipelineInput = { url: 'https://invalid.example.com' };

      await expect(runPipeline(input, mockLlm)).rejects.toThrow('Failed to fetch');
    });

    it('propagates concept analyzer errors', async () => {
      (runConceptAnalyzer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM timeout'));

      const input: PipelineInput = { text: 'Content' };

      await expect(runPipeline(input, mockLlm)).rejects.toThrow('LLM timeout');
    });
  });
});
