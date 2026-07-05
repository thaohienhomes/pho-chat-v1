import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { users } from '@/database/schemas';
import { getServerDB } from '@/database/server';

const SYSTEM_PROMPT = `
You are an AI assistant for the Phở Platform admin (Mission Control).
Your job is to parse natural language commands from the admin via Telegram.
You must output ONLY raw JSON, with no markdown formatting or extra text.
Available actions:
- check_user_status: When the admin wants to look up a user by email or id. Requires "email" or "id" field.
- sync_subscription: When the admin wants to force fix/sync a user's subscription. Requires "email" or "id" field.
- unknown: When the request does not match available commands. Include a "reply" field with a conversational response asking for clarification.

Example input: "Check user hung@gmail.com"
Example output: {"action": "check_user_status", "email": "hung@gmail.com"}

Example input: "Fix sync for user 12345"
Example output: {"action": "sync_subscription", "id": "12345"}
`;

async function sendTelegramMessage(chatId: string | number, text: string) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) return;

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      body: JSON.stringify({
        chat_id: chatId,
        parse_mode: 'HTML',
        text: text, // Allow code block formatting
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  } catch (err) {
    console.error('[Telegram Ops] Fetch error:', err);
  }
}

async function parseIntentWithLLM(text: string) {
  // Use Vercel AI Gateway which acts as an OpenAI-compatible proxy to all models
  const apiKey = process.env.VERCELAIGATEWAY_API_KEY;
  const apiUrl = 'https://ai-gateway.vercel.sh/v1';

  if (!apiKey) {
    console.error('[Telegram Ops] VERCELAIGATEWAY_API_KEY is not set');
    return null;
  }

  try {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      body: JSON.stringify({
        // Format: provider/model
        messages: [
          { content: SYSTEM_PROMPT, role: 'system' },
          { content: text, role: 'user' },
        ],
        model: 'google/gemini-2.0-flash',
        // Cost attribution in the Vercel AI Gateway dashboard
        providerOptions: { gateway: { tags: ['app:pho-chat', 'feature:telegram-ops'] } },
      }),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      console.error('[Telegram Ops] Vercel AI Gateway Error:', await response.text());
      return null;
    }

    const data = await response.json();
    const resultText = data.choices[0]?.message?.content;

    // Observe-only spend telemetry (cost-audit WS2-2d) — fire-and-forget
    void import('@/libs/posthog-server')
      .then(({ captureAiGeneration }) =>
        captureAiGeneration({
          costPoints: 0,
          feature: 'telegram-ops',
          inputTokens: data.usage?.prompt_tokens ?? 0,
          model: 'google/gemini-2.0-flash',
          outputTokens: data.usage?.completion_tokens ?? 0,
          provider: 'vercelaigateway',
          userId: 'telegram-ops',
        }),
      )
      .catch(() => {});

    // Safety parse if the model wraps it in markdown blocks
    const cleanJson = resultText.replaceAll('```json', '').replaceAll('```', '').trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    console.error('[Telegram Ops] Intent Parsing Failed:', err);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = body.message;

    if (!message || !message.text) {
      return NextResponse.json({ status: 'ok' });
    }

    const chatId = message.chat.id;
    const text = message.text;

    console.log(`[Telegram Ops] Command from ${chatId}: ${text}`);

    if (text.startsWith('/ping')) {
      await sendTelegramMessage(chatId, '🏓 Pong! PhoPlatform Guard Bot is online.');
      return NextResponse.json({ status: 'ok' });
    }

    // Call LLM to parse intent
    await sendTelegramMessage(chatId, '⚙️ Parsing command...');
    const parsedIntent = await parseIntentWithLLM(text);

    if (!parsedIntent) {
      await sendTelegramMessage(chatId, '❌ Failed to parse command. Please try again.');
      return NextResponse.json({ status: 'ok' });
    }

    switch (parsedIntent.action) {
      case 'unknown': {
        await sendTelegramMessage(
          chatId,
          parsedIntent.reply || 'I am not sure how to help with that.',
        );

        break;
      }
      case 'check_user_status': {
        const identifier = parsedIntent.email || parsedIntent.id;
        if (!identifier) {
          await sendTelegramMessage(chatId, '❌ Please provide an email or user ID to check.');
        } else {
          await sendTelegramMessage(chatId, `🔍 Searching DB for <b>${identifier}</b>...`);
          const db = await getServerDB();
          let userRecord;
          if (identifier.includes('@')) {
            const [u] = await db.select().from(users).where(eq(users.email, identifier)).limit(1);
            userRecord = u;
          } else {
            const [u] = await db.select().from(users).where(eq(users.id, identifier)).limit(1);
            userRecord = u;
          }

          if (!userRecord) {
            await sendTelegramMessage(chatId, `❌ User <b>${identifier}</b> not found in Neon DB.`);
          } else {
            const reply = `👤 <b>USER FOUND</b>
ID: <code>${userRecord.id}</code>
Name: <b>${userRecord.fullName || 'N/A'}</b>
Email: ${userRecord.email || 'N/A'}
Plan: <b>${userRecord.currentPlanId}</b>
Status: <b>${userRecord.subscriptionStatus}</b>
Phở Points: <code>${userRecord.phoPointsBalance?.toLocaleString() || 0}</code>
`;
            await sendTelegramMessage(chatId, reply);
          }
        }

        break;
      }
      case 'sync_subscription': {
        const identifier = parsedIntent.email || parsedIntent.id;
        if (!identifier) {
          await sendTelegramMessage(chatId, '❌ Please provide an email or user ID to sync.');
        } else {
          await sendTelegramMessage(chatId, `⚙️ Executing Sync action for <b>${identifier}</b>...`);
          const db = await getServerDB();
          let userRecords = [];
          if (identifier.includes('@')) {
            userRecords = await db.select().from(users).where(eq(users.email, identifier));
          } else {
            userRecords = await db.select().from(users).where(eq(users.id, identifier));
          }

          if (userRecords.length === 0) {
            await sendTelegramMessage(chatId, `❌ User <b>${identifier}</b> not found in Neon DB.`);
          } else {
            const now = new Date();
            const pointsResetDate = new Date(
              now.getFullYear(),
              now.getMonth() + 1,
              0,
              23,
              59,
              59,
              999,
            );

            for (const record of userRecords) {
              // Force the subscription status to ACTIVE and upgrade to Medical Beta
              await db
                .update(users)
                .set({
                  currentPlanId: 'medical_beta',
                  phoPointsBalance: Math.max(record.phoPointsBalance || 0, 500_000),
                  pointsResetDate: pointsResetDate,
                  subscriptionStatus: 'ACTIVE',
                })
                .where(eq(users.id, record.id));
            }

            await sendTelegramMessage(
              chatId,
              `✅ <b>SYNC HOTFIX APPLIED (${userRecords.length} records)</b>
Target: <b>${identifier}</b>
Action: Upgraded to <b>Medical Beta</b> & Status set to <b>ACTIVE</b>.
The user's Phở Points balance has also been topped up. They now have full access.`,
            );
          }
        }

        break;
      }
      default: {
        // Just dumping the parsed intent for now (Step 2)
        await sendTelegramMessage(
          chatId,
          `🧠 Intent Parsed:\n<pre><code class="language-json">${JSON.stringify(parsedIntent, null, 2)}</code></pre>`,
        );
        // In Step 3 & 4 we will actually execute these intents against the DB
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[Telegram Webhook] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
