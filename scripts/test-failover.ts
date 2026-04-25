#!/usr/bin/env tsx
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();
dotenv.config({ path: '.env.local' });

const API_URL = 'http://127.0.0.1:3010/api/labs/pho-gateway';

async function runBenchmark(testName: string, model: string, provider?: string) {
  console.log(`\n🚀 [BENCHMARK] ${testName}`);
  console.log(`   Model: ${model}, Provider Base: ${provider || 'Logical'}`);
  console.log('='.repeat(50));

  const startTime = Date.now();

  try {
    const response = await fetch(API_URL, {
      body: JSON.stringify({
        messages: [{ content: 'Say "Hi" in strictly 2 words.', role: 'user' }],
        model: model,
        provider: provider,
        stream: false,
      }),
      headers: {
        'Authorization': `Bearer ${process.env.PHO_GATEWAY_LABS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [FAILED] Status: ${response.status}`);
      console.error(`   Message: ${errorText}`);
      return;
    }

    // Handle the response body robustly
    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      // If it's a stream or partial JSON, just show the snippet
      data = { snippet: rawText.slice(0, 100) };
    }

    console.log(`✅ [SUCCESS] Duration: ${duration}ms`);

    // Show actual provider from headers
    if (response.headers.has('X-Pho-Provider')) {
      console.log(`   Actual Provider Used: ${response.headers.get('X-Pho-Provider')}`);
    }
    if (response.headers.has('X-Pho-Model-ID')) {
      console.log(`   Internal Model ID: ${response.headers.get('X-Pho-Model-ID')}`);
    }

    // Show content
    const content = data?.choices?.[0]?.message?.content || data?.snippet || 'No content parsed';
    console.log(`   Response: ${content.trim()}...`);
  } catch (error: any) {
    console.error(`❌ [ERROR] ${error.message}`);
  }
}

async function main() {
  process.stdout.write('\u001Bc'); // Clear console
  console.log('🧪 Starting Phở Gateway Failover Benchmark...');
  console.log('--------------------------------------------');

  // Test 1: Logical Model (Fast)
  await runBenchmark('Logical Model Test (pho-test-fast)', 'pho-test-fast');

  // Test 2: Specific Provider (Groq) with Fallback
  await runBenchmark(
    'Specific Model with Fallback (llama-3.1-8b-instant)',
    'llama-3.1-8b-instant',
    'groq',
  );

  console.log('\n🏁 Benchmark Complete.');
}

try {
  await main();
} catch (error) {
  console.error(error);
}
