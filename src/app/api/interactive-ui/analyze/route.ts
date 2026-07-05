import { NextResponse } from 'next/server';

import type { VisionAnalysisOptions } from '@/components/InteractiveUI/types';
import { VisionAnalysisService } from '@/services/vision-analysis';

/**
 * POST /api/interactive-ui/analyze
 *
 * Accepts an image URL and returns structured InteractiveRegions data.
 * Used by the chat UI to detect interactive regions in uploaded images.
 *
 * Request body:
 *   { imageUrl: string, options?: VisionAnalysisOptions }
 *
 * Response:
 *   VisionAnalysisResult
 */
export async function POST(req: Request) {
  try {
    // Cost-audit WS2-2d: this endpoint burns Tier-2/3 vision models. It was
    // completely unauthenticated — anyone could POST an image URL and spend
    // gateway credits. Mirror the artifact-ai route's Clerk gate.
    let userId: string | null = null;
    try {
      const { auth } = await import('@clerk/nextjs/server');
      const session = await auth();
      userId = session.userId;
    } catch {
      // Clerk auth not available
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { imageUrl, options } = body as {
      imageUrl: string;
      options?: VisionAnalysisOptions;
    };

    if (!imageUrl || !VisionAnalysisService.isValidImageSource(imageUrl)) {
      return NextResponse.json(
        { data: null, error: 'Invalid or missing imageUrl', model: 'none', success: false },
        { status: 400 },
      );
    }

    const result = await VisionAnalysisService.analyzeImage(imageUrl, options || {}, userId);

    return NextResponse.json(result, {
      status: result.success ? 200 : 502,
    });
  } catch (error) {
    console.error('[InteractiveUI/analyze] Error:', error);
    return NextResponse.json(
      {
        data: null,
        error: error instanceof Error ? error.message : 'Internal server error',
        model: 'none',
        success: false,
      },
      { status: 500 },
    );
  }
}
