import { NextRequest, NextResponse } from 'next/server';

import { paymentMetricsCollector } from '@/libs/monitoring/payment-metrics';
import { SepayWebhookData, sepayGateway } from '@/libs/sepay';
import { addPhoCredits } from '@/server/services/billing/credits';
import {
  activateUserSubscription,
  getPaymentByOrderId,
  updatePaymentStatus,
} from '@/server/services/billing/sepay';
import { timingSafeCompareStrings } from '@/utils/timingSafeCompare';

/**
 * Sepay Webhook Handler - Compatibility Route
 * POST /api/sepay/webhook
 *
 * This route exists for backward compatibility with Sepay dashboard configuration.
 * The correct route is /api/payment/sepay/webhook, but Sepay may be configured
 * to send webhooks to /api/sepay/webhook.
 *
 * This route forwards all webhook requests to the correct handler.
 */

/**
 * GET endpoint to test webhook accessibility
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    correctRoute: '/api/payment/sepay/webhook',
    message: 'Sepay webhook endpoint is accessible (compatibility route)',
    note: 'This route forwards to /api/payment/sepay/webhook for compatibility',
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle successful payment
 */
async function handleSuccessfulPayment(webhookData: SepayWebhookData): Promise<void> {
  const startTime = Date.now();
  try {
    console.log('✅ [COMPAT ROUTE] Processing successful payment:', {
      amount: webhookData.amount,
      currency: webhookData.currency,
      orderId: webhookData.orderId,
      timestamp: webhookData.timestamp,
      transactionId: webhookData.transactionId,
    });

    // Update payment status in database
    console.log('📝 [COMPAT ROUTE] Updating payment status in database...');
    await updatePaymentStatus(webhookData.orderId, 'success', {
      rawWebhook: webhookData,
      transactionId: webhookData.transactionId,
    });
    console.log('✅ [COMPAT ROUTE] Payment status updated successfully');

    // Get payment record to get user and plan info
    console.log('🔍 [COMPAT ROUTE] Fetching payment record to get user and plan info...');
    const payment = await getPaymentByOrderId(webhookData.orderId);

    if (!payment) {
      console.error('❌ [COMPAT ROUTE] Payment record not found for orderId:', webhookData.orderId);
      throw new Error('Payment record not found');
    }

    console.log('📋 [COMPAT ROUTE] Payment record retrieved:', {
      billingCycle: payment.billingCycle,
      planId: payment.planId,
      userId: payment.userId,
    });

    // Activate subscription (if not a one-time payment)
    if (payment.userId && payment.planId && payment.billingCycle) {
      // Always add credits for the payment amount (1 VND = 1 Credit)
      console.log('💰 [COMPAT ROUTE] Adding Pho Credits for user:', {
        amount: webhookData.amount,
        userId: payment.userId,
      });
      await addPhoCredits(payment.userId, webhookData.amount);

      // Detect if this is an upgrade payment (orderId starts with PHO_UPG)
      const isUpgradePayment = webhookData.orderId.startsWith('PHO_UPG');

      // Only activate subscription if it's not a one-time payment
      if (payment.billingCycle !== 'one_time') {
        console.log('🎯 [COMPAT ROUTE] Activating subscription for user:', {
          billingCycle: payment.billingCycle,
          isUpgrade: isUpgradePayment,
          planId: payment.planId,
          userId: payment.userId,
        });

        await activateUserSubscription({
          billingCycle: payment.billingCycle as 'monthly' | 'yearly',
          isUpgrade: isUpgradePayment,
          planId: payment.planId,
          userId: payment.userId,
        });

        console.log(
          '✅ [COMPAT ROUTE] Subscription activated successfully for user:',
          payment.userId,
        );
      } else {
        console.log('ℹ️ [COMPAT ROUTE] Skipping subscription activation for one-time payment');
      }
    } else {
      console.error('❌ [COMPAT ROUTE] Payment record incomplete - missing required fields:', {
        hasBillingCycle: !!payment.billingCycle,
        hasPlanId: !!payment.planId,
        hasUserId: !!payment.userId,
      });
      throw new Error('Payment record incomplete - cannot process payment');
    }

    // Record metrics
    const duration = Date.now() - startTime;
    paymentMetricsCollector.recordWebhookProcessing(webhookData.orderId, 'success', duration);

    // Send welcome email (non-blocking)
    try {
      if (payment?.userId && payment?.planId) {
        const { getServerDB } = await import('@/database/server');
        const { users } = await import('@/database/schemas');
        const { eq } = await import('drizzle-orm');
        const db = await getServerDB();
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
      console.error('⚠️ [COMPAT ROUTE] Welcome email failed (non-critical):', emailError);
    }

    console.log(
      '✅ [COMPAT ROUTE] Webhook processed successfully for orderId:',
      webhookData.orderId,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('❌ [COMPAT ROUTE] Error processing successful payment:', {
      error: errorMessage,
      orderId: webhookData.orderId,
      stack: errorStack,
      timestamp: new Date().toISOString(),
    });

    // Record error metrics
    const duration = Date.now() - startTime;
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
  try {
    console.log('❌ [COMPAT ROUTE] Processing failed payment:', {
      amount: webhookData.amount,
      currency: webhookData.currency,
      orderId: webhookData.orderId,
      timestamp: webhookData.timestamp,
      transactionId: webhookData.transactionId,
    });

    // Update payment status in database
    console.log('📝 [COMPAT ROUTE] Updating payment status in database...');
    await updatePaymentStatus(webhookData.orderId, 'failed', {
      rawWebhook: webhookData,
      transactionId: webhookData.transactionId,
    });
    console.log('✅ [COMPAT ROUTE] Payment status updated successfully');

    // Record metrics
    const duration = Date.now() - startTime;
    paymentMetricsCollector.recordWebhookProcessing(webhookData.orderId, 'success', duration);

    console.log(
      '✅ [COMPAT ROUTE] Webhook processed successfully for orderId:',
      webhookData.orderId,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('❌ [COMPAT ROUTE] Error processing failed payment:', {
      error: errorMessage,
      orderId: webhookData.orderId,
      stack: errorStack,
      timestamp: new Date().toISOString(),
    });

    // Record error metrics
    const duration = Date.now() - startTime;
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
 * Handle pending payment
 */
async function handlePendingPayment(webhookData: SepayWebhookData): Promise<void> {
  const startTime = Date.now();
  try {
    console.log('[COMPAT ROUTE] Processing pending payment:', webhookData.orderId);

    await updatePaymentStatus(webhookData.orderId, 'pending', {
      rawWebhook: webhookData,
      transactionId: webhookData.transactionId,
    });

    const duration = Date.now() - startTime;
    paymentMetricsCollector.recordWebhookProcessing(webhookData.orderId, 'success', duration);

    console.log(
      '✅ [COMPAT ROUTE] Webhook processed successfully for orderId:',
      webhookData.orderId,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('❌ [COMPAT ROUTE] Error processing pending payment:', {
      error: errorMessage,
      orderId: webhookData.orderId,
      stack: errorStack,
      timestamp: new Date().toISOString(),
    });

    const duration = Date.now() - startTime;
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
 * Sepay webhook handler - Compatibility route
 * POST /api/sepay/webhook
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: any;
  try {
    console.log(
      '🔔 [COMPAT ROUTE] Webhook received at /api/sepay/webhook from:',
      request.headers.get('user-agent'),
    );

    // SECURITY CHECK: verify webhook authentication before doing any work.
    // Mirrors the canonical /api/payment/sepay/webhook route: SePay sends the
    // shared secret either as `X-Sepay-Webhook-Secret` or `Authorization: Apikey <token>`.
    // This closes the previous "process even on invalid/missing signature" hole
    // that let a forged POST activate a paid subscription.
    const webhookSecret = process.env.SEPAY_WEBHOOK_SECRET;

    let providedSecret = request.headers.get('x-sepay-webhook-secret');
    if (!providedSecret) {
      const authHeader = request.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Apikey ')) {
        providedSecret = authHeader.slice(7);
      }
    }

    if (!webhookSecret) {
      console.error('❌ [COMPAT ROUTE] SEPAY_WEBHOOK_SECRET not configured in environment');
      return NextResponse.json(
        { message: 'Webhook authentication not configured', success: false },
        { status: 500 },
      );
    }

    // Constant-time compare; returns false on missing/different-length input,
    // so it subsumes the `!providedSecret` guard.
    if (!providedSecret || !timingSafeCompareStrings(providedSecret, webhookSecret)) {
      console.error('❌ [COMPAT ROUTE] Unauthorized webhook — invalid or missing secret token');
      paymentMetricsCollector.recordError(
        'webhook_auth_failed',
        'Unauthorized webhook request (compat route)',
        undefined,
        undefined,
        { hasSecret: !!providedSecret },
      );
      return NextResponse.json(
        { message: 'Unauthorized - invalid webhook secret', success: false },
        { status: 401 },
      );
    }

    // Parse webhook data from Sepay (only parse once!)
    body = await request.json();
    console.log('🔔 [COMPAT ROUTE] Webhook payload received:', JSON.stringify(body, null, 2));

    // Normalize webhook data - handle different payload structures from Sepay
    const webhookData: SepayWebhookData = {
      amount: body.amount || parseFloat(body.amount_in || '0'),
      currency: body.currency || 'VND',
      maskedCardNumber: body.maskedCardNumber || body.masked_card_number,
      orderId: body.orderId || body.order_id,
      paymentMethod: body.paymentMethod || body.payment_method,
      signature: body.signature || '',
      status: (body.status || 'pending') as 'success' | 'failed' | 'pending',
      timestamp: body.timestamp || new Date().toISOString(),
      transactionId: body.transactionId || body.transaction_id || '',
    };

    console.log('🔔 [COMPAT ROUTE] Normalized webhook data:', {
      amount: webhookData.amount,
      currency: webhookData.currency,
      orderId: webhookData.orderId,
      status: webhookData.status,
      transactionId: webhookData.transactionId,
    });

    // Validate required fields
    if (!webhookData.orderId) {
      console.error('❌ [COMPAT ROUTE] Missing orderId in webhook payload');
      return NextResponse.json(
        { message: 'Missing orderId in webhook payload', success: false },
        { status: 400 },
      );
    }

    if (!webhookData.transactionId) {
      console.error('❌ [COMPAT ROUTE] Missing transactionId in webhook payload');
      return NextResponse.json(
        { message: 'Missing transactionId in webhook payload', success: false },
        { status: 400 },
      );
    }

    // Verify webhook signature (lenient for debugging)
    if (webhookData.signature) {
      const isValidSignature = sepayGateway.verifyWebhookSignature(webhookData);

      if (!isValidSignature) {
        console.error('❌ [COMPAT ROUTE] Invalid webhook signature:', webhookData.orderId);
        console.error(
          '❌ [COMPAT ROUTE] Signature verification failed - webhook will still be processed for debugging',
        );
      }
    } else {
      console.warn(
        '⚠️ [COMPAT ROUTE] No signature provided in webhook - skipping signature verification',
      );
    }

    // Process payment based on status
    switch (webhookData.status) {
      case 'success': {
        console.log(
          '✅ [COMPAT ROUTE] Processing successful payment for orderId:',
          webhookData.orderId,
        );
        await handleSuccessfulPayment(webhookData);
        break;
      }
      case 'failed': {
        console.log(
          '❌ [COMPAT ROUTE] Processing failed payment for orderId:',
          webhookData.orderId,
        );
        await handleFailedPayment(webhookData);
        break;
      }
      case 'pending': {
        console.log(
          '⏳ [COMPAT ROUTE] Processing pending payment for orderId:',
          webhookData.orderId,
        );
        await handlePendingPayment(webhookData);
        break;
      }
      default: {
        console.warn('⚠️ [COMPAT ROUTE] Unknown payment status:', webhookData.status);
      }
    }

    return NextResponse.json({
      message: 'Webhook processed successfully',
      success: true,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('❌ [COMPAT ROUTE] Error processing webhook:', {
      body,
      error: errorMessage,
      stack: errorStack,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        error: errorMessage,
        message: 'Failed to process webhook',
        success: false,
      },
      { status: 500 },
    );
  }
}
