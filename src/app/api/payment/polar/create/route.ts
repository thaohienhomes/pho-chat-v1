/**
 * Polar.sh Checkout Creation API
 *
 * POST /api/payment/polar/create
 *
 * Creates a Polar checkout session for international payments
 */
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createCheckoutSession, getPolarProductIds } from '@/libs/polar';

// Valid plan IDs for Polar checkout
// Accepts both legacy codes (starter, premium, ultimate) and new global codes (gl_*)
const VALID_POLAR_PLAN_IDS = [
  // Legacy codes (for backward compatibility)
  'starter',
  'premium',
  'ultimate',
  // New global plan codes (from PRICING_MASTERPLAN)
  'gl_standard',
  'gl_premium',
  'gl_lifetime',
] as const;

// Map plan IDs to Polar internal codes
const PLAN_ID_TO_POLAR_CODE: Record<string, 'starter' | 'premium' | 'ultimate'> = {
  // New global codes map to Polar codes
  gl_lifetime: 'ultimate',

  // Lifetime maps to ultimate tier
  gl_premium: 'premium',

  gl_standard: 'starter',

  // Legacy codes map directly
  premium: 'premium',
  starter: 'starter',
  ultimate: 'ultimate', // Standard maps to starter tier
};

// Request validation schema
const CreateCheckoutSchema = z.object({
  billingCycle: z.enum(['monthly', 'yearly']),
  cancelUrl: z.string().url().optional(),
  customerEmail: z.string().email().optional(),
  customerName: z.string().optional(),
  planId: z.enum(VALID_POLAR_PLAN_IDS),
  successUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const { userId } = await auth();

    if (!userId) {
      console.error('❌ Polar checkout: Unauthorized - no userId');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse and validate request body
    const body = await req.json();
    console.log('💳 Polar checkout request:', { body, userId });

    const validation = CreateCheckoutSchema.safeParse(body);

    if (!validation.success) {
      console.error('❌ Polar checkout: Invalid request', validation.error.errors);
      return NextResponse.json(
        { details: validation.error.errors, error: 'Invalid request' },
        { status: 400 },
      );
    }

    const { planId, billingCycle, successUrl, cancelUrl, customerEmail, customerName } =
      validation.data;

    // 3. Map planId to Polar internal code
    const polarPlanCode = PLAN_ID_TO_POLAR_CODE[planId];
    if (!polarPlanCode) {
      console.error('❌ Polar checkout: Invalid plan ID mapping', { planId });
      return NextResponse.json(
        {
          error: 'Invalid plan',
          message: `Plan "${planId}" is not supported for Polar checkout. Use global plans (gl_standard, gl_premium, gl_lifetime).`,
        },
        { status: 400 },
      );
    }

    // 4. Get Polar product and price IDs using mapped code
    const { productId, priceId } = getPolarProductIds(polarPlanCode, billingCycle);
    console.log('📦 Polar product IDs:', {
      billingCycle,
      planId,
      polarPlanCode,
      priceId,
      productId,
    });

    // Validate product ID is configured
    if (!productId) {
      console.error('❌ Polar checkout: Product ID not configured', { billingCycle, planId });
      return NextResponse.json(
        {
          error: 'Product not configured',
          message: `Polar product ID for ${planId} (${billingCycle}) is not configured. Please check environment variables.`,
        },
        { status: 500 },
      );
    }

    // 4. Get base URL for redirect URLs
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://pho.chat');
    console.log('🌐 Base URL:', baseUrl);

    // 5. Create checkout session
    const checkoutParams = {
      cancelUrl: cancelUrl || `${baseUrl}/settings?active=subscription&canceled=true`,
      customerEmail,
      customerName,
      metadata: {
        billingCycle,
        planId,
        source: 'pho.chat',
        userId,
      },
      priceId,
      productId,
      successUrl: successUrl || `${baseUrl}/settings?active=subscription&success=true`,
    };
    console.log('🔧 Creating Polar checkout session:', checkoutParams);

    const session = await createCheckoutSession(checkoutParams);
    console.log('✅ Polar checkout session created:', { sessionId: session.id, url: session.url });

    // 6. Return checkout URL
    return NextResponse.json({
      checkoutUrl: session.url,
      sessionId: session.id,
      success: true,
    });
  } catch (error) {
    console.error('❌ Polar checkout creation error:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        error: 'Failed to create checkout session',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

// OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Origin': '*',
    },
    status: 200,
  });
}
