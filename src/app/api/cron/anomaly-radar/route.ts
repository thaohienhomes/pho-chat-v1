import { and, eq, lte, ne, desc, lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { sepayPayments, users } from '@/database/schemas';
import { getServerDB } from '@/database/server';

// Helper function to send Telegram messages
async function sendTelegramMessage(text: string) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = '748471251'; // Admin chat ID obtained from previous interactions

    if (!BOT_TOKEN) {
        console.error('[Anomaly Radar Cron] TELEGRAM_BOT_TOKEN missing');
        return;
    }

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            body: JSON.stringify({
                chat_id: CHAT_ID,
                parse_mode: 'HTML',
                text: text
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
        });
    } catch (err) {
        console.error('[Anomaly Radar Cron] Fetch error:', err);
    }
}

// ─── Auth / session incident detection (PostHog) ────────────────────────────
// The "can't use the app for days" failure mode for PAID users is almost never
// billing — it's auth: Clerk session tokens the server rejects (kid/instance
// mismatch, JWKS rotation lag), surfacing as repeated client `auth_session_expired`
// events + tRPC `UNAUTHORIZED`. That signal lives in PostHog, not the DB, so the
// DB-only checks below are blind to it. A user with several expiries and ZERO
// successful `$ai_generation` in the window is effectively locked out
// (2026-06 incident: nga.ntv@gmail.com — 9 expiries / 0 messages in a day on
// vn_ultimate, while billing/plan/points were all healthy).
//
// Requires POSTHOG_API_KEY (personal key, phx_…) in the Vercel runtime env —
// same key scripts/posthog-usage-alert.ts uses. When absent the check is skipped
// and the DB anomaly checks still run; it never throws into the cron handler.
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID || '306983';
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;

// Rolling window slightly wider than the hourly cron cadence so no expiry slips
// through the gap between runs. Every threshold is env-tunable without redeploy.
const AUTH_WINDOW_MINUTES = Number(process.env.AUTH_INCIDENT_WINDOW_MIN) || 90;
const STUCK_MIN_EXPIRED = Number(process.env.AUTH_INCIDENT_STUCK_EXPIRED) || 2;
const SPIKE_MIN_USERS = Number(process.env.AUTH_INCIDENT_SPIKE_USERS) || 4;
const SPIKE_MIN_EVENTS = Number(process.env.AUTH_INCIDENT_SPIKE_EVENTS) || 12;

interface AuthUserRow {
    distinctId: string;
    email: string | null;
    expired: number;
    gens: number;
}

interface AuthIncidentSummary {
    affectedUsers: number;
    stuckUsers: AuthUserRow[];
    totalExpired: number;
}

/**
 * Per-user `auth_session_expired` vs `$ai_generation` counts over the recent
 * window. A row with many expiries and gens=0 is a locked-out user.
 */
async function queryAuthExpiryRows(): Promise<AuthUserRow[]> {
    const sql = `
        SELECT
            distinct_id,
            any(person.properties.email) AS email,
            countIf(event = 'auth_session_expired') AS expired,
            countIf(event = '$ai_generation') AS gens
        FROM events
        WHERE timestamp >= now() - INTERVAL ${AUTH_WINDOW_MINUTES} MINUTE
            AND event IN ('auth_session_expired', '$ai_generation')
        GROUP BY distinct_id
        HAVING expired > 0
        ORDER BY expired DESC
        LIMIT 50
    `;

    const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
        body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
        headers: {
            'Authorization': `Bearer ${POSTHOG_API_KEY}`,
            'Content-Type': 'application/json',
        },
        method: 'POST',
    });

    if (!res.ok) {
        throw new Error(`PostHog query ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const data = (await res.json()) as { results?: any[][] };
    return (data.results || []).map((r) => ({
        distinctId: String(r[0]),
        email: r[1] ? String(r[1]) : null,
        expired: Number(r[2]) || 0,
        gens: Number(r[3]) || 0,
    }));
}

/**
 * Detect an in-progress auth/session incident. Returns a summary when an alert
 * should fire, or null when all-clear / not configured / on error — auth
 * detection must never break the DB anomaly checks.
 */
async function detectAuthIncidents(): Promise<AuthIncidentSummary | null> {
    if (!POSTHOG_API_KEY) {
        console.warn('[Anomaly Radar Cron] POSTHOG_API_KEY missing — skipping auth incident check');
        return null;
    }

    try {
        const rows = await queryAuthExpiryRows();
        if (rows.length === 0) return null;

        const totalExpired = rows.reduce((sum, r) => sum + r.expired, 0);
        // Locked-out users: repeated expiries with no successful generation in the window.
        const stuckUsers = rows.filter((r) => r.expired >= STUCK_MIN_EXPIRED && r.gens === 0);

        // Alert on individual lock-outs OR a systemic surge in affected users / events.
        const shouldAlert =
            stuckUsers.length > 0 || rows.length >= SPIKE_MIN_USERS || totalExpired >= SPIKE_MIN_EVENTS;

        if (!shouldAlert) return null;

        return { affectedUsers: rows.length, stuckUsers, totalExpired };
    } catch (e) {
        console.error('[Anomaly Radar Cron] Auth incident check failed:', e);
        return null;
    }
}

export async function GET() {
    // You might want to verify cron secret here if accessing from Vercel
    // Check for authorization header if needed

    try {
        const db = await getServerDB();

        // 1. Detect Desync: Users on paid plans but stuck with 'FREE' status.
        const subscriptionAnomalies = await db
            .select()
            .from(users)
            .where(
                and(
                    ne(users.currentPlanId, 'vn_free'),
                    ne(users.currentPlanId, 'gl_starter'),
                    eq(users.subscriptionStatus, 'FREE')
                )
            );

        // 2. Negative Balance Anomalies
        const negativePointsAnomalies = await db
            .select()
            .from(users)
            .where(lt(users.phoPointsBalance, 0));

        // 3. Stuck Pending Payments (Older than 2 hours)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const stuckPayments = await db
            .select()
            .from(sepayPayments)
            .where(
                and(
                    eq(sepayPayments.status, 'pending'),
                    lte(sepayPayments.createdAt, twoHoursAgo)
                )
            )
            .orderBy(desc(sepayPayments.createdAt))
            .limit(20);

        if (subscriptionAnomalies.length > 0) {
            let msg = `🚨 <b>ANOMALY RADAR ALERT</b> 🚨\n\n`;
            msg += `Found <b>${subscriptionAnomalies.length}</b> Subscription Desyncs (Paid plan but FREE status).\n`;

            // List a few
            for (const anomaly of subscriptionAnomalies.slice(0, 5)) {
                msg += `- <code>${anomaly.email || anomaly.id}</code> (Plan: ${anomaly.currentPlanId})\n`;
            }
            if (subscriptionAnomalies.length > 5) msg += `...and ${subscriptionAnomalies.length - 5} more.\n`;

            msg += `\nReply with "Fix sync [email]" to auto-resolve.`;
            await sendTelegramMessage(msg);
        }

        if (negativePointsAnomalies.length > 0) {
            let msg = `⚠️ <b>ANOMALY RADAR ALERT</b> ⚠️\n\n`;
            msg += `Found <b>${negativePointsAnomalies.length}</b> Negative Points Balances.\n`;

            for (const anomaly of negativePointsAnomalies.slice(0, 5)) {
                msg += `- <code>${anomaly.email || anomaly.id}</code> (Balance: ${anomaly.phoPointsBalance})\n`;
            }
            await sendTelegramMessage(msg);
        }

        if (stuckPayments.length > 0) {
            let msg = `⏳ <b>STUCK PAYMENTS ALERT</b> ⏳\n\n`;
            msg += `Found <b>${stuckPayments.length}</b> Sepay transactions stuck in 'pending' for >2 hours.\n`;

            for (const payment of stuckPayments.slice(0, 5)) {
                msg += `- Order: <code>${payment.orderId}</code> (${payment.amountVnd?.toLocaleString()} VND)\n`;
            }
            if (stuckPayments.length > 5) msg += `...and ${stuckPayments.length - 5} more.\n`;
            await sendTelegramMessage(msg);
        }

        // 4. Auth/session incident (PostHog) — the "can't use the app" signal for
        //    paid users that the DB-only checks above are completely blind to.
        const authIncident = await detectAuthIncidents();

        if (authIncident) {
            let msg = `🔐 <b>AUTH INCIDENT RADAR</b> 🔐\n\n`;
            msg += `Cửa sổ ${AUTH_WINDOW_MINUTES} phút: <b>${authIncident.totalExpired}</b> phiên hết hạn trên <b>${authIncident.affectedUsers}</b> user.\n`;

            if (authIncident.stuckUsers.length > 0) {
                msg += `\n🔴 <b>${authIncident.stuckUsers.length}</b> user KẸT (hết phiên nhiều lần + 0 generation = không dùng được):\n`;
                for (const u of authIncident.stuckUsers.slice(0, 8)) {
                    msg += `- <code>${u.email || u.distinctId}</code> — ${u.expired} lần\n`;
                }
                if (authIncident.stuckUsers.length > 8) {
                    msg += `...và ${authIncident.stuckUsers.length - 8} user khác.\n`;
                }
            }

            msg += `\nNghi ngờ Clerk JWT verify fail (kid/instance mismatch hoặc JWKS rotation lag). `;
            msg += `Kiểm CLERK_SECRET_KEY ↔ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY cùng instance, rồi redeploy.`;
            await sendTelegramMessage(msg);
        }

        // We report success to the cron runner
        return NextResponse.json({
            authSessionExpired: authIncident?.totalExpired ?? 0,
            authStuckUsers: authIncident?.stuckUsers.length ?? 0,
            desyncs: subscriptionAnomalies.length,
            negativePoints: negativePointsAnomalies.length,
            status: 'ok',
            stuckPayments: stuckPayments.length
        });

    } catch (e) {
        console.error('[Anomaly Radar Cron] Error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
