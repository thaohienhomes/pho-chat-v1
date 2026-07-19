import { WebhookVerificationError, validateEvent } from '@polar-sh/sdk/webhooks';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/server';
import { logWebhookEvent } from '@/libs/webhookLogger';

/**
 * Map Polar product IDs to plan configuration.
 * Uses env vars for monthly/yearly subscriptions and lifetime deals,
 * with hardcoded UUID fallbacks for existing lifetime customers.
 */
function buildPolarProductMap(): Record<
  string,
  { billingCycle: string; lifetimeDeal: boolean; planId: string }
> {
  const map: Record<string, { billingCycle: string; lifetimeDeal: boolean; planId: string }> = {};

  // Monthly/Yearly subscriptions (from env vars)
  const subscriptionMappings = [
    { billingCycle: 'monthly', envVar: 'POLAR_PRODUCT_STARTER_MONTHLY_ID', planId: 'gl_standard' },
    { billingCycle: 'yearly', envVar: 'POLAR_PRODUCT_STARTER_YEARLY_ID', planId: 'gl_standard' },
    { billingCycle: 'monthly', envVar: 'POLAR_PRODUCT_PREMIUM_MONTHLY_ID', planId: 'gl_premium' },
    { billingCycle: 'yearly', envVar: 'POLAR_PRODUCT_PREMIUM_YEARLY_ID', planId: 'gl_premium' },
  ] as const;

  for (const { envVar, planId, billingCycle } of subscriptionMappings) {
    const productId = process.env[envVar];
    if (productId) {
      map[productId] = { billingCycle, lifetimeDeal: false, planId };
    }
  }

  // Lifetime deals (from env vars)
  const lifetimeMappings = [
    { envVar: 'POLAR_PRODUCT_LIFETIME_EARLY_BIRD_ID', planId: 'lifetime_early_bird' },
    { envVar: 'POLAR_PRODUCT_LIFETIME_STANDARD_ID', planId: 'lifetime_standard' },
    { envVar: 'POLAR_PRODUCT_LIFETIME_LAST_CALL_ID', planId: 'lifetime_last_call' },
    { envVar: 'POLAR_PRODUCT_ULTIMATE_ID', planId: 'lifetime_last_call' },
  ] as const;

  for (const { envVar, planId } of lifetimeMappings) {
    const productId = process.env[envVar];
    if (productId) {
      map[productId] = { billingCycle: 'lifetime', lifetimeDeal: true, planId };
    }
  }

  // Hardcoded UUID fallbacks for existing lifetime customers
  map['85158f39-dd9d-4ed9-b344-9afa5eba5080'] = {
    billingCycle: 'lifetime',
    lifetimeDeal: true,
    planId: 'lifetime_early_bird',
  };
  map['01faa30d-bfb7-4699-8916-4288591d3fa6'] = {
    billingCycle: 'lifetime',
    lifetimeDeal: true,
    planId: 'lifetime_standard',
  };
  map['646af452-89ad-439b-9109-8840320e2485'] = {
    billingCycle: 'lifetime',
    lifetimeDeal: true,
    planId: 'lifetime_last_call',
  };

  return map;
}

const POLAR_PRODUCT_MAP = buildPolarProductMap();

/**
 * Allocate Phở Points for lifetime members
 */
async function allocateLifetimePoints(db: any, userId: string, planId: string) {
  try {
    const schemas: any = await import('@lobechat/database/schemas');
    const { phoPointsBalances } = schemas;

    // Dynamic import config to avoid circular deps if needed, though type import is safe
    const { USD_PRICING_TIERS } = await import('@/server/modules/CostOptimization');

    const tierConfig = USD_PRICING_TIERS[planId as keyof typeof USD_PRICING_TIERS];
    const points = tierConfig?.monthlyPoints || 2_000_000;

    // Check if balance exists
    const [existing] = await db
      .select()
      .from(phoPointsBalances)
      .where(eq(phoPointsBalances.userId, userId))
      .limit(1);

    if (existing) {
      // Update existing balance
      await db
        .update(phoPointsBalances)
        .set({
          balance: points,
          lastResetAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(phoPointsBalances.userId, userId));
    } else {
      // Create new balance
      await db.insert(phoPointsBalances).values({
        balance: points,
        createdAt: new Date(),
        lastResetAt: new Date(),
        updatedAt: new Date(),
        userId,
      });
    }

    console.log(`✅ Allocated ${points.toLocaleString()} Phở Points to user ${userId}`);
  } catch (error) {
    console.error('❌ Failed to allocate points:', error);
    // Don't throw - subscription is already created
  }
}

export async function POST(req: Request) {
  try {
    const { serverAnalytics } = await import('@/libs/analytics');
    const body = await req.text();

    // ── HMAC Signature Verification ────────────────────────────────
    // Polar webhooks use standardwebhooks (svix-compatible) signature format.
    // SDK's validateEvent verifies the HMAC signature *first*, then parses the
    // payload into a typed event:
    //   • invalid signature            → WebhookVerificationError → reject 403
    //   • valid signature, but the SDK
    //     doesn't model the event type  → SDKValidationError (signature already OK)
    // Because verification happens before schema parsing, an SDKValidationError
    // means the signature was VALID and we just can't type the event (e.g. a newer
    // Polar type like "member.created" that the pinned @polar-sh/sdk doesn't know).
    // We recover the event from the already-verified raw body and continue, so
    // recognized payment events are still handled and unrecognized ones fall through
    // to the 200 acknowledgement below.
    //
    // NOTE: PHO-250/A1.14 previously returned 401 for this case, treating a
    // valid-signature event as a signature failure. That misclassification made
    // Polar assume delivery failed and retry indefinitely (error-tracking noise for
    // non-payment events like member.created). The security concern behind PHO-250 —
    // "raw body parsed before the signature is confirmed" — does not apply: the raw
    // body is only trusted here *after* validateEvent has verified the signature.
    const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[Polar Webhook] POLAR_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }

    let event: any;
    try {
      event = validateEvent(body, Object.fromEntries(req.headers.entries()), webhookSecret);
    } catch (verifyErr: any) {
      if (verifyErr instanceof WebhookVerificationError) {
        console.error('[Polar Webhook] Invalid signature:', verifyErr.message);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }

      // Only fall back to the raw body for schema-parsing failures, which the SDK
      // raises *after* the signature has been verified. Any other error type happens
      // before the signature is confirmed, so we must not trust the body — reject it.
      const isSchemaError = verifyErr?.name === 'SDKValidationError';
      if (!isSchemaError) {
        console.error('[Polar Webhook] Signature validation failed:', {
          error: verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
          errorType: verifyErr?.constructor?.name,
        });
        return NextResponse.json({ error: 'WEBHOOK_SIGNATURE_INVALID' }, { status: 401 });
      }

      console.warn('[Polar Webhook] Signature valid but event type not modeled by SDK; ' +
        'continuing with verified raw payload:', {
        error: verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
        errorType: verifyErr?.constructor?.name,
      });
      try {
        event = JSON.parse(body);
      } catch {
        // A signature-verified Polar delivery should always be valid JSON; guard anyway.
        console.error('[Polar Webhook] Verified payload was not valid JSON');
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
    }

    console.log('📥 Polar Webhook Event:', {
      email: event.data?.customer_email || event.data?.customer?.email,
      productId: event.data?.product_id,
      type: event.type,
    });

    // Handle successful payment
    if (event.type === 'checkout.completed' || event.type === 'order.created') {
      const customer_email = event.data.customer_email || event.data.customer?.email;
      const { product_id } = event.data;

      if (!customer_email) {
        console.error('❌ No customer email in webhook data');
        return NextResponse.json({ error: 'No customer email' }, { status: 400 });
      }

      // Map Product ID → Plan config
      const productMapping = POLAR_PRODUCT_MAP[product_id];
      if (!productMapping) {
        console.error(`❌ [Polar Webhook] Unknown product ID: ${product_id}`);
        return NextResponse.json({ error: 'Unknown product' }, { status: 400 });
      }
      const { planId, billingCycle, lifetimeDeal } = productMapping;

      const db: any = await getServerDB();
      const schemas: any = await import('@lobechat/database/schemas');
      const { users, subscriptions } = schemas;

      // Find user by email
      const [user] = await db.select().from(users).where(eq(users.email, customer_email)).limit(1);

      if (!user) {
        console.error('❌ User not found:', customer_email);
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Create/Update subscription
      const start = new Date();
      let end: Date;
      if (billingCycle === 'lifetime') {
        end = new Date('2099-12-31');
      } else if (billingCycle === 'yearly') {
        end = new Date(start);
        end.setFullYear(end.getFullYear() + 1);
      } else {
        // monthly
        end = new Date(start);
        end.setMonth(end.getMonth() + 1);
      }

      // Check if subscription exists
      const [existing] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, user.id))
        .limit(1);

      if (existing) {
        // Update existing subscription
        await db
          .update(subscriptions)
          .set({
            billingCycle,
            cancelAtPeriodEnd: false,
            currentPeriodEnd: end,
            currentPeriodStart: start,
            paymentProvider: 'polar',
            planId,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, user.id));
      } else {
        // Create new subscription
        await db.insert(subscriptions).values({
          billingCycle,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: end,
          currentPeriodStart: start,
          paymentProvider: 'polar',
          planId,
          status: 'active',
          userId: user.id,
        });
      }

      // Sync users.currentPlanId for fallback consistency
      await db
        .update(users)
        .set({ currentPlanId: planId, subscriptionStatus: 'ACTIVE' })
        .where(eq(users.id, user.id));
      console.log('✅ users.currentPlanId + subscriptionStatus synced to:', planId);

      // Allocate Phở Points
      await allocateLifetimePoints(db, user.id, planId);

      // Sync wallet tier based on plan
      try {
        const { syncWalletTier } = await import('@/libs/wallet/tierSync');
        await syncWalletTier(db, user.id, planId);
      } catch (walletError) {
        console.error('⚠️ Failed to sync wallet tier (non-critical):', walletError);
      }

      console.log('✅ User activated:', {
        email: customer_email,
        planId,
        productId: product_id,
        userId: user.id,
      });

      // PostHog Revenue Tracking - Source of Truth
      // Polar sends amounts in cents (e.g. 2900 = $29.00) if using USD
      // We assume USD for now based on Polar context
      const amountUSD = (event.data.amount || 0) / 100;

      serverAnalytics.track({
        name: 'payment_succeeded',
        properties: {
          $currency: event.data.currency || 'USD',
          $revenue: amountUSD, // Special PostHog property for Revenue charts
          billing_period: billingCycle,
          payment_provider: 'polar',
          plan_id: planId,
          product_id: product_id,
        },
        userId: user.id,
      });

      serverAnalytics.track({
        name: 'subscription_created',
        properties: {
          plan_id: planId,
          status: 'active',
          type: billingCycle,
        },
        userId: user.id,
      });

      // Sync Clerk publicMetadata for UI consistency (non-blocking)
      try {
        const clerkSecretKey = process.env.CLERK_SECRET_KEY;
        if (clerkSecretKey) {
          await fetch(`https://api.clerk.com/v1/users/${user.id}/metadata`, {
            body: JSON.stringify({
              public_metadata: {
                billingCycle,
                lifetimeDeal,
                planId,
                promoActivatedAt: new Date().toISOString(),
              },
            }),
            headers: {
              'Authorization': `Bearer ${clerkSecretKey}`,
              'Content-Type': 'application/json',
            },
            method: 'PATCH',
          });
          console.log('✅ Clerk metadata synced for user:', user.id);
        }
      } catch (clerkErr) {
        console.error('⚠️ Clerk metadata sync failed (non-critical):', clerkErr);
      }

      // Send welcome email (non-blocking — failures don't affect webhook)
      try {
        const { sendWelcomeEmail } = await import('@/libs/email');
        await sendWelcomeEmail({
          email: customer_email,
          name: user.fullName || user.firstName || customer_email.split('@')[0] || 'there',
          planId,
        });
      } catch (emailError) {
        console.error('⚠️ Welcome email failed (non-critical):', emailError);
      }

      return NextResponse.json({ planId, success: true, userId: user.id });
    }

    // Handle refund
    if (event.type === 'order.refunded') {
      const customer_email = event.data.customer_email || event.data.customer?.email;

      if (!customer_email) {
        return NextResponse.json({ error: 'No customer email' }, { status: 400 });
      }

      const db: any = await getServerDB();
      const schemas: any = await import('@lobechat/database/schemas');
      const { users, subscriptions } = schemas;

      const [user] = await db.select().from(users).where(eq(users.email, customer_email)).limit(1);

      if (user) {
        // Revoke subscription
        await db
          .update(subscriptions)
          .set({
            planId: 'gl_starter', // Downgrade to free
            status: 'canceled',
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, user.id));

        // Sync wallet tier to free
        try {
          const { syncWalletTier } = await import('@/libs/wallet/tierSync');
          await syncWalletTier(db, user.id, 'gl_starter');
        } catch (walletError) {
          console.error('⚠️ Failed to sync wallet tier on refund:', walletError);
        }

        console.log('⚠️ User plan revoked due to refund:', customer_email);
      }

      return NextResponse.json({ success: true });
    }

    // Other events - just acknowledge
    void logWebhookEvent({
      eventType: 'other',
      payload: body as any,
      provider: 'polar',
      status: 'ignored',
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    void logWebhookEvent({
      errorMessage: error instanceof Error ? error.message : String(error),
      eventType: 'error',
      provider: 'polar',
      status: 'error',
    });
    return NextResponse.json(
      {
        details: error instanceof Error ? error.message : 'Unknown error',
        error: 'Webhook processing failed',
      },
      { status: 500 },
    );
  }
}
