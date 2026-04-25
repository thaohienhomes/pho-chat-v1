import { eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { VN_PLANS } from '@/config/pricing';
import { sepayPayments, subscriptions, users } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { paymentMetricsCollector } from '@/libs/monitoring/payment-metrics';
import { SepayWebhookData, sepayGateway } from '@/libs/sepay';
import { sendTikTokServerEvent } from '@/libs/tiktok-events-api';
import { logWebhookEvent } from '@/libs/webhookLogger';
import { getPaymentByOrderId } from '@/server/services/billing/sepay';

/**
 * GET endpoint to test webhook accessibility
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    message: 'Sepay webhook endpoint is accessible',
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle successful payment
 *
 * TRANSACTION SAFETY: This function wraps payment status update and subscription activation
 * in a database transaction to ensure atomicity. If subscription activation fails, the payment
 * status update is automatically rolled back, preventing inconsistent state where payment is
 * marked as successful but user has no active subscription.
 */
async function handleSuccessfulPayment(webhookData: SepayWebhookData): Promise<void> {
  const startTime = Date.now();
  const db = await getServerDB();

  try {
    console.log('✅ Processing successful payment:', {
      amount: webhookData.amount,
      orderId: webhookData.orderId,
      timestamp: new Date().toISOString(),
      transactionId: webhookData.transactionId,
    });

    // Execute payment processing in a database transaction
    // This ensures both payment update and subscription activation succeed or fail together
    await db.transaction(async (tx) => {
      console.log('🔄 Starting database transaction for payment processing...');

      // Step 1: Update payment record status and attach webhook payload
      console.log('📝 Updating payment status in database...');
      await tx
        .update(sepayPayments)
        .set({
          rawWebhook: webhookData,
          status: 'success',
          transactionId: webhookData.transactionId,
        })
        .where(eq(sepayPayments.orderId, webhookData.orderId));
      console.log('✅ Payment status updated successfully');

      // Step 2: Fetch the payment record to get user and plan info
      console.log('🔍 Fetching payment record to get user and plan info...');
      const paymentRows = await tx
        .select()
        .from(sepayPayments)
        .where(eq(sepayPayments.orderId, webhookData.orderId))
        .limit(1);

      if (!paymentRows || paymentRows.length === 0) {
        console.error('❌ Payment record not found for orderId:', webhookData.orderId);
        throw new Error(`Payment record not found for orderId: ${webhookData.orderId}`);
      }

      const payment = paymentRows[0];
      console.log('✅ Payment record retrieved:', {
        billingCycle: payment.billingCycle,
        planId: payment.planId,
        userId: payment.userId,
      });

      // Step 3: Validate payment record has required fields
      if (!payment.userId || !payment.planId || !payment.billingCycle) {
        console.error('❌ Payment record incomplete - missing required fields:', {
          hasBillingCycle: !!payment.billingCycle,
          hasPlanId: !!payment.planId,
          hasUserId: !!payment.userId,
        });
        throw new Error('Payment record incomplete - cannot activate subscription');
      }

      // Step 4: Set Pho Points based on plan's monthlyPoints (NOT 1 VND = 1 credit)
      // Look up the plan config to get the correct monthlyPoints allocation
      const planConfig = VN_PLANS[payment.planId];
      const planMonthlyPoints = planConfig?.monthlyPoints ?? 500_000;

      console.log('💰 Setting Phở Points for user:', {
        monthlyPoints: planMonthlyPoints,
        planId: payment.planId,
        userId: payment.userId,
      });

      await tx
        .update(users)
        .set({
          lifetimeSpent: sql`${users.lifetimeSpent} + ${webhookData.amount}`,
          phoPointsBalance: planMonthlyPoints,
        })
        .where(eq(users.id, payment.userId));

      // Step 5: Activate subscription (upsert behavior) if not one-time
      if (payment.billingCycle && payment.billingCycle !== 'one_time') {
        console.log('🎯 Activating subscription for user:', {
          billingCycle: payment.billingCycle,
          planId: payment.planId,
          userId: payment.userId,
        });

        // ... (Rest of subscription logic follows)

        // Detect if this is an upgrade payment (orderId starts with PHO_UPG)
        const isUpgradePayment = webhookData.orderId.startsWith('PHO_UPG');
        console.log('Payment type:', isUpgradePayment ? 'UPGRADE' : 'NEW_SUBSCRIPTION');

        // Check if user already has a subscription
        const existing = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.userId, payment.userId));

        if (isUpgradePayment && existing.length > 0) {
          // UPGRADE PAYMENT: Preserve existing period dates, only update plan
          const existingSubscription = existing[0];
          console.log('🔄 Processing upgrade - preserving existing period:', {
            currentPeriodEnd: existingSubscription.currentPeriodEnd,
            currentPeriodStart: existingSubscription.currentPeriodStart,
            newPlanId: payment.planId,
            oldPlanId: existingSubscription.planId,
          });

          await tx
            .update(subscriptions)
            .set({
              billingCycle: payment.billingCycle,
              // Preserve existing period dates for upgrades
              currentPeriodEnd: existingSubscription.currentPeriodEnd,
              currentPeriodStart: existingSubscription.currentPeriodStart,
              paymentProvider: 'sepay',
              planId: payment.planId,
              status: 'active',
            })
            .where(eq(subscriptions.userId, payment.userId));
          console.log('✅ Subscription upgraded successfully for user:', payment.userId);
        } else {
          // NEW SUBSCRIPTION or RENEWAL: Create new billing period
          const start = new Date();
          const end = new Date(start);
          end.setDate(end.getDate() + (payment.billingCycle === 'yearly' ? 365 : 30));

          console.log('📅 Creating new billing period:', {
            currentPeriodEnd: end,
            currentPeriodStart: start,
          });

          if (existing.length > 0) {
            // Update existing subscription with new period
            await tx
              .update(subscriptions)
              .set({
                billingCycle: payment.billingCycle,
                currentPeriodEnd: end,
                currentPeriodStart: start,
                paymentProvider: 'sepay',
                planId: payment.planId,
                status: 'active',
              })
              .where(eq(subscriptions.userId, payment.userId));
            console.log('✅ Subscription renewed successfully for user:', payment.userId);
          } else {
            // Create new subscription
            await tx.insert(subscriptions).values({
              billingCycle: payment.billingCycle,
              currentPeriodEnd: end,
              currentPeriodStart: start,
              planId: payment.planId,
              status: 'active',
              userId: payment.userId,
            });
            console.log('✅ Subscription created successfully for user:', payment.userId);
          }
        }

        // Sync wallet tier based on new plan
        try {
          const { syncWalletTier } = await import('@/libs/wallet/tierSync');
          await syncWalletTier(tx as any, payment.userId, payment.planId);
          console.log('✅ Wallet tier synced for user:', payment.userId);
        } catch (walletError) {
          console.error('⚠️ Failed to sync wallet tier (non-critical):', walletError);
        }

        // Sync users.currentPlanId for fallback consistency
        await tx
          .update(users)
          .set({ currentPlanId: payment.planId, subscriptionStatus: 'ACTIVE' })
          .where(eq(users.id, payment.userId));
        console.log('✅ users.currentPlanId + subscriptionStatus synced to:', payment.planId);
      }

      console.log('✅ Transaction committed successfully');
    });

    // Track successful subscription purchase with TikTok Events API
    try {
      const payment = await getPaymentByOrderId(webhookData.orderId);
      if (payment?.userId && payment?.planId && payment?.amountVnd) {
        console.log('📊 Tracking TikTok Subscribe event for successful payment...');
        await sendTikTokServerEvent({
          event: 'Subscribe',
          event_time: Math.floor(Date.now() / 1000),
          properties: {
            contents: [
              {
                content_id: payment.planId,
                content_name: `${payment.planId} (${payment.billingCycle})`,
                content_type: 'product',
                price: payment.amountVnd,
              },
            ],
            currency: 'VND',
            value: payment.amountVnd,
          },
          user: {
            external_id: payment.userId, // Will be hashed by the function
          },
        });
        console.log('✅ TikTok Subscribe event tracked successfully');
      }
    } catch (tiktokError) {
      // Don't fail the webhook if TikTok tracking fails
      console.error('⚠️ Failed to track TikTok event (non-critical):', tiktokError);
    }

    const duration = Date.now() - startTime;
    paymentMetricsCollector.recordWebhookProcessing(webhookData.orderId, 'success', duration);

    // Track successful payment to PostHog Revenue Dashboard
    try {
      const { serverAnalytics } = await import('@/libs/analytics');

      // Revenue Event
      serverAnalytics.track({
        name: 'payment_succeeded',
        properties: {
          $currency: webhookData.currency || 'VND',
          $revenue: webhookData.amount, // Sepay sends full amount (e.g. 500000)
          billing_period: webhookData.orderId.includes('lifetime') ? 'lifetime' : 'monthly', // simplistic check
          order_id: webhookData.orderId,
          payment_method: webhookData.paymentMethod,
          payment_provider: 'sepay',
        },
        userId: webhookData.orderId.split('_').slice(2).join('_') || 'unknown', // Attempt to recover userId from OrderID if possible (PHO_SUB_Timestamp_Code isn't userId, so we rely on DB lookup if possible, but here we only have webhookData)
      });

      // Subscription Created Event
      serverAnalytics.track({
        name: 'subscription_created',
        properties: {
          amount: webhookData.amount,
          currency: 'VND',
          order_id: webhookData.orderId,
          status: 'active',
        },
        userId: webhookData.orderId, // Fallback ID
      });
    } catch (analyticsError) {
      console.error('⚠️ Failed to track PostHog revenue (non-critical):', analyticsError);
    }

    // Sync Clerk publicMetadata for UI consistency (non-blocking)
    try {
      const payment = await getPaymentByOrderId(webhookData.orderId);
      if (payment?.userId && payment?.planId) {
        const clerkSecretKey = process.env.CLERK_SECRET_KEY;
        if (clerkSecretKey) {
          await fetch(`https://api.clerk.com/v1/users/${payment.userId}/metadata`, {
            body: JSON.stringify({
              public_metadata: {
                planId: payment.planId,
              },
            }),
            headers: {
              'Authorization': `Bearer ${clerkSecretKey}`,
              'Content-Type': 'application/json',
            },
            method: 'PATCH',
          });
          console.log('✅ Clerk metadata synced for user:', payment.userId);
        }
      }
    } catch (clerkErr) {
      console.error('⚠️ Clerk metadata sync failed (non-critical):', clerkErr);
    }

    // Send welcome email (non-blocking, outside DB transaction)
    try {
      const payment = await getPaymentByOrderId(webhookData.orderId);
      if (payment?.userId && payment?.planId) {
        const [user] = await db
          .select({ email: users.email, firstName: users.firstName, fullName: users.fullName })
          .from(users)
          .where(eq(users.id, payment.userId))
          .limit(1);
        if (user?.email) {
          const { sendWelcomeEmail } = await import('@/libs/email');
          await sendWelcomeEmail({
            email: user.email,
            name: user.fullName || user.firstName || user.email.split('@')[0] || 'there',
            planId: payment.planId,
          });
        }
      }
    } catch (emailError) {
      console.error('⚠️ Welcome email failed (non-critical):', emailError);
    }

    console.log('✅ Successfully processed payment:', {
      duration: `${duration}ms`,
      orderId: webhookData.orderId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('❌ Error processing successful payment (transaction rolled back):', {
      duration: `${duration}ms`,
      error: errorMessage,
      orderId: webhookData.orderId,
      stack: errorStack,
      timestamp: new Date().toISOString(),
    });

    paymentMetricsCollector.recordWebhookProcessing(
      webhookData.orderId,
      'failure',
      duration,
      errorMessage,
    );
    throw error;
  }
}

/**
 * Handle failed payment
 */
async function handleFailedPayment(webhookData: SepayWebhookData): Promise<void> {
  const startTime = Date.now();
  const db = await getServerDB();

  try {
    console.log('Processing failed payment:', webhookData.orderId);

    await db
      .update(sepayPayments)
      .set({
        rawWebhook: webhookData,
        status: 'failed',
        transactionId: webhookData.transactionId,
      })
      .where(eq(sepayPayments.orderId, webhookData.orderId));

    const duration = Date.now() - startTime;
    paymentMetricsCollector.recordWebhookProcessing(webhookData.orderId, 'success', duration);

    console.log('Successfully processed failed payment:', webhookData.orderId);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    paymentMetricsCollector.recordWebhookProcessing(
      webhookData.orderId,
      'failure',
      duration,
      errorMessage,
    );
    console.error('Error processing failed payment:', error);
    throw error;
  }
}

/**
 * Handle pending payment
 */
async function handlePendingPayment(webhookData: SepayWebhookData): Promise<void> {
  const startTime = Date.now();
  const db = await getServerDB();

  try {
    console.log('Processing pending payment:', webhookData.orderId);

    await db
      .update(sepayPayments)
      .set({
        rawWebhook: webhookData,
        status: 'pending',
        transactionId: webhookData.transactionId,
      })
      .where(eq(sepayPayments.orderId, webhookData.orderId));

    const duration = Date.now() - startTime;
    paymentMetricsCollector.recordWebhookProcessing(webhookData.orderId, 'success', duration);

    console.log('Successfully processed pending payment:', webhookData.orderId);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    paymentMetricsCollector.recordWebhookProcessing(
      webhookData.orderId,
      'failure',
      duration,
      errorMessage,
    );
    console.error('Error processing pending payment:', error);
    throw error;
  }
}

/**
 * Extract orderId from Sepay bank transfer content
 * Sepay sends bank transfer details in the content field with format:
 * "phohat Premium Plan monthly billing RUCSIA1762228747088NTK3U9 FT25308710231543..."
 *
 * We need to extract the timestamp and random code to reconstruct the orderId:
 * Pattern: [PREFIX]_[TIMESTAMP]_[RANDOM] -> PHO_SUB_1762228747088_NTK3U9
 */
function extractOrderIdFromContent(content: string): string | null {
  // Look for pattern: 13-digit timestamp followed by 6 uppercase alphanumeric characters
  // Example: "RUCSIA1762228747088NTK3U9" -> extract "1762228747088" and "NTK3U9"
  const pattern = /(\d{13})([\dA-Z]{6})/;
  const match = content.match(pattern);

  if (match) {
    const timestamp = match[1];
    const randomCode = match[2];
    // Reconstruct the orderId with our standard format
    const orderId = `PHO_SUB_${timestamp}_${randomCode}`;
    console.log('✅ Extracted orderId from content:', {
      content,
      orderId,
      randomCode,
      timestamp,
    });
    return orderId;
  }

  console.warn('⚠️ Could not extract orderId from content:', content);
  return null;
}

/**
 * Sepay webhook handler
 * POST /api/payment/sepay/webhook
 *
 * SECURITY: This endpoint is protected by webhook secret token authentication.
 * Sepay must include the secret token in the X-Sepay-Webhook-Secret header.
 * This prevents unauthorized parties from sending fake webhooks to activate subscriptions.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: any;
  try {
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const forwardedFor = request.headers.get('x-forwarded-for');
    const origin = request.headers.get('origin');
    const contentType = request.headers.get('content-type');

    console.log('Webhook received from:', userAgent);
    console.log('Webhook headers (sanitized):', {
      'content-type': contentType,
      origin,
      'x-forwarded-for': forwardedFor,
    });

    // SECURITY CHECK: Verify webhook authentication
    // Sepay can send the webhook secret token in two formats:
    // 1. X-Sepay-Webhook-Secret header (custom header format)
    // 2. Authorization: Apikey <token> header (API Key format)
    const webhookSecret = process.env.SEPAY_WEBHOOK_SECRET;

    // Try to get secret from X-Sepay-Webhook-Secret header first
    let providedSecret = request.headers.get('x-sepay-webhook-secret');

    // If not found, try to extract from Authorization header (format: "Apikey <token>")
    if (!providedSecret) {
      const authHeader = request.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Apikey ')) {
        providedSecret = authHeader.slice(7); // Remove "Apikey " prefix
        console.log('🔑 Extracted secret from Authorization header');
      }
    }

    if (!webhookSecret) {
      console.error('❌ SEPAY_WEBHOOK_SECRET not configured in environment variables');
      return NextResponse.json(
        { message: 'Webhook authentication not configured', success: false },
        { status: 500 },
      );
    }

    if (!providedSecret || providedSecret !== webhookSecret) {
      console.error('❌ Unauthorized webhook request - invalid or missing secret token');
      console.error('❌ Provided secret:', providedSecret ? '[REDACTED]' : 'NONE');
      console.error(
        '❌ Authorization header:',
        request.headers.get('authorization') ? '[REDACTED]' : 'NONE',
      );

      paymentMetricsCollector.recordError(
        'webhook_auth_failed',
        'Unauthorized webhook request',
        undefined,
        undefined,
        { hasAuthHeader: !!request.headers.get('authorization'), hasSecret: !!providedSecret },
      );

      return NextResponse.json(
        { message: 'Unauthorized - invalid webhook secret', success: false },
        { status: 401 },
      );
    }

    console.log('✅ Webhook authentication successful');

    // Parse webhook data from Sepay (only parse once!)
    body = await request.json();
    console.log('🔔 Webhook payload received:', JSON.stringify(body, null, 2));

    // SECURITY NOTE: Manual verification has been removed from this endpoint.
    // Manual payment verification must be done through the dedicated authenticated endpoint:
    // POST /api/payment/sepay/verify-manual (requires Clerk authentication)
    // This prevents unauthorized users from manually verifying payments without proper authentication.

    // Extract orderId early for idempotency check
    let orderId: string | null = null;

    // Try to extract orderId from different webhook formats
    if (body.orderId || body.order_id) {
      orderId = body.orderId || body.order_id;
    } else if (body.gateway === 'vietqr' || body.content) {
      // Bank transfer format - extract from content
      orderId = extractOrderIdFromContent(body.content || body.description || '');
    }

    // IDEMPOTENCY CHECK: Verify if webhook has already been processed
    // This prevents duplicate processing if Sepay sends the same webhook multiple times
    if (orderId) {
      console.log('🔍 Checking if webhook already processed for orderId:', orderId);
      const existingPayment = await getPaymentByOrderId(orderId);

      if (
        existingPayment &&
        existingPayment.status === 'success' &&
        existingPayment.transactionId
      ) {
        console.log('⚠️ Webhook already processed (idempotent):', {
          orderId: existingPayment.orderId,
          processedAt: existingPayment.updatedAt,
          status: existingPayment.status,
          transactionId: existingPayment.transactionId,
        });

        // Return success to acknowledge webhook (don't reprocess)
        return NextResponse.json({
          idempotent: true,
          message: 'Webhook already processed',
          orderId: existingPayment.orderId,
          success: true,
          transactionId: existingPayment.transactionId,
        });
      }

      console.log('✅ Webhook not yet processed, continuing...');
    }

    // Detect webhook format: Sepay sends different formats for different payment methods
    let webhookData: SepayWebhookData;

    // Format 1: Bank transfer webhook (VietQR)
    // Example: { gateway: "vietqr", content: "...", transferAmount: 129000, id: "28956687", ... }
    if (body.gateway === 'vietqr' || body.content) {
      console.log('🏦 Detected bank transfer webhook format (VietQR)');

      // Extract orderId from content field
      const orderId = extractOrderIdFromContent(body.content || body.description || '');

      if (!orderId) {
        console.error('❌ Could not extract orderId from bank transfer content');
        return NextResponse.json(
          {
            content: body.content,
            message: 'Could not extract orderId from bank transfer content',
            success: false,
          },
          { status: 400 },
        );
      }

      webhookData = {
        amount: parseFloat(body.transferAmount || body.amount || '0'),
        currency: 'VND',
        orderId: orderId,
        paymentMethod: 'bank_transfer',
        signature: '', // Bank transfer webhooks don't have signatures
        status: 'success', // Sepay only sends webhooks for successful transfers
        timestamp: new Date().toISOString(),
        transactionId: body.id || body.transactionId || '',
      };
    }
    // Format 2: Credit card webhook (standard format)
    // Example: { orderId: "PHO_CC_...", transactionId: "...", amount: 129000, status: "success", ... }
    else {
      console.log('💳 Detected credit card webhook format (standard)');

      webhookData = {
        amount: body.amount || parseFloat(body.amount_in || '0'),
        currency: body.currency || 'VND',
        maskedCardNumber: body.maskedCardNumber || body.masked_card_number,
        orderId: body.orderId || body.order_id,
        paymentMethod: body.paymentMethod || body.payment_method || 'credit_card',
        signature: body.signature || '',
        status: (body.status || 'pending') as 'success' | 'failed' | 'pending',
        timestamp: body.timestamp || new Date().toISOString(),
        transactionId: body.transactionId || body.transaction_id || '',
      };
    }

    console.log('🔔 Normalized webhook data:', {
      amount: webhookData.amount,
      currency: webhookData.currency,
      orderId: webhookData.orderId,
      paymentMethod: webhookData.paymentMethod,
      status: webhookData.status,
      transactionId: webhookData.transactionId,
    });

    // Validate required fields
    if (!webhookData.orderId) {
      console.error('❌ Missing orderId in webhook payload');
      console.error('❌ Raw webhook body:', JSON.stringify(body, null, 2));
      return NextResponse.json(
        {
          message: 'Missing orderId in webhook payload',
          rawBody: body,
          success: false,
        },
        { status: 400 },
      );
    }

    if (!webhookData.transactionId) {
      console.error('❌ Missing transactionId in webhook payload');
      console.error('❌ Webhook data:', JSON.stringify(webhookData, null, 2));
      return NextResponse.json(
        {
          message: 'Missing transactionId in webhook payload',
          success: false,
          webhookData,
        },
        { status: 400 },
      );
    }

    // Verify webhook signature (skip for bank transfers only)
    // Bank transfers use webhook secret token authentication instead of signature verification
    if (webhookData.paymentMethod === 'bank_transfer') {
      // Bank transfer authenticated via webhook secret header (checked earlier)
      // Skip signature verification for bank_transfer
    } else if (webhookData.signature) {
      const isValidSignature = sepayGateway.verifyWebhookSignature(webhookData);

      if (!isValidSignature) {
        console.error('[SePay Webhook] Invalid signature, rejecting:', webhookData.orderId);
        return NextResponse.json({ error: 'Invalid signature', success: false }, { status: 403 });
      }
    } else {
      // No signature provided and not bank_transfer → reject
      console.error(
        '[SePay Webhook] Missing signature for non-bank_transfer payment:',
        webhookData.orderId,
      );
      return NextResponse.json({ error: 'Signature required', success: false }, { status: 403 });
    }

    // Log to admin webhook viewer
    void logWebhookEvent({
      amountUsd: String(webhookData.amount || ''),
      eventType: `payment.${webhookData.status}`,
      orderId: webhookData.orderId,
      payload: webhookData as any,
      provider: 'sepay',
      status: 'received',
    });

    // Process payment based on status
    switch (webhookData.status) {
      case 'success': {
        console.log(' Processing successful payment for orderId:', webhookData.orderId);
        await handleSuccessfulPayment(webhookData);
        void logWebhookEvent({
          eventType: `payment.${webhookData.status}`,
          orderId: webhookData.orderId,
          provider: 'sepay',
          status: 'success',
        });
        break;
      }
      case 'failed': {
        console.log('❌ Processing failed payment for orderId:', webhookData.orderId);
        await handleFailedPayment(webhookData);
        void logWebhookEvent({
          eventType: 'payment.failed',
          orderId: webhookData.orderId,
          provider: 'sepay',
          status: 'error',
        });
        break;
      }
      case 'pending': {
        console.log('⏳ Processing pending payment for orderId:', webhookData.orderId);
        await handlePendingPayment(webhookData);
        void logWebhookEvent({
          eventType: 'payment.pending',
          orderId: webhookData.orderId,
          provider: 'sepay',
          status: 'received',
        });
        break;
      }
      default: {
        console.warn('⚠️ Unknown payment status:', webhookData.status);
        void logWebhookEvent({
          eventType: `payment.${webhookData.status}`,
          orderId: webhookData.orderId,
          provider: 'sepay',
          status: 'ignored',
        });
      }
    }

    // Return success response to Sepay
    console.log('✅ Webhook processed successfully for orderId:', webhookData.orderId);
    return NextResponse.json({ message: 'Webhook processed', success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('❌ Sepay webhook processing error:', {
      body: body ? JSON.stringify(body) : 'No body parsed',
      error: errorMessage,
      stack: errorStack,
      timestamp: new Date().toISOString(),
    });

    paymentMetricsCollector.recordError(
      'webhook_processing_error',
      errorMessage,
      undefined,
      undefined,
      { error: String(error), stack: errorStack },
    );

    return NextResponse.json(
      { error: errorMessage, message: 'Webhook processing failed', success: false },
      { status: 500 },
    );
  }
}

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Origin': '*',
    },
    status: 200,
  });
}
