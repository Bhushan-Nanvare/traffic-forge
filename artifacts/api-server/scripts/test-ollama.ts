/**
 * Standalone smoke test: forces the Reporter to call Ollama by setting
 * LLM_PROVIDER=ollama before importing, then runs one bug analysis.
 *
 * Run with:
 *   cd artifacts/api-server
 *   LLM_PROVIDER=ollama OLLAMA_MODEL=llama3.2:3b npx tsx scripts/test-ollama.ts
 *
 * Expected output:
 *   - "LLM client chain configured" log shows primary=ollama
 *   - One Reporter call, ~30-90 seconds on a 3B CPU model
 *   - Final block prints provider=ollama and the analysis text
 */
process.env.LLM_PROVIDER = 'ollama';
process.env.LLM_FALLBACK = 'ollama'; // disable groq fallback so we know Ollama is what produced the result
process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

import { OllamaLLMClient } from '../src/shared/llm/ollama.js';
import { Reporter } from '../src/features/trafficforge/engine/reporter.js';
import { getLLMClient } from '../src/shared/llm/index.js';

async function main() {
  const client = getLLMClient();
  console.log(`\n🔍 LLM client: provider=${client.provider}, model=${client.model}, available=${client.available}\n`);

  if (client.provider !== 'ollama') {
    console.error('❌ Wrong provider — expected ollama');
    process.exit(1);
  }

  const reporter = new Reporter();

  const fakeBug = {
    id: 'test-bug-1',
    type: 'race_condition' as const,
    severity: 'high' as const,
    title: 'Concurrent writes to shopping cart',
    description: '5 agents added the same item to cart simultaneously; final cart count was wrong by 2',
    evidence: [
      {
        type: 'event' as const,
        description: 'Agent 1 click on .add-to-cart at 14:23:45.001',
        timestamp: Date.now() - 5000,
      },
      {
        type: 'event' as const,
        description: 'Agent 3 click on .add-to-cart at 14:23:45.003',
        timestamp: Date.now() - 5000,
      },
    ],
    confidence: 0.85,
    appType: 'ecommerce',
    detectedAt: Date.now(),
  };

  // ── Strict test: call OllamaLLMClient directly with no fallback path ──
  console.log('⏳ Step 1/2: calling Ollama directly via OllamaLLMClient (no fallback)...\n');
  const direct = new OllamaLLMClient({ model: process.env.OLLAMA_MODEL });
  const directStart = Date.now();
  try {
    const directResult = await direct.generateWithTool<{ rootCause: string; severity: string }>({
      systemPrompt: 'You are a bug analyst. Always call the analyze tool.',
      userPrompt: 'A shopping cart shows wrong totals when 5 users add the same item. Analyze it.',
      tool: {
        name: 'analyze',
        description: 'Submit your bug analysis',
        parameters: {
          type: 'object',
          properties: {
            rootCause: { type: 'string', description: 'One sentence root cause' },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['rootCause', 'severity'],
        },
      },
      maxTokens: 256,
    });
    const directElapsed = ((Date.now() - directStart) / 1000).toFixed(1);
    console.log(`✅ Direct Ollama call succeeded in ${directElapsed}s`);
    console.log(`   provider:  ${directResult.provider}`);
    console.log(`   model:     ${directResult.model}`);
    console.log(`   rootCause: ${JSON.stringify(directResult.result.rootCause)}`);
    console.log(`   severity:  ${JSON.stringify(directResult.result.severity)}`);
    console.log(`   cost USD:  $${directResult.usage.estimatedUsd.toFixed(4)}\n`);
  } catch (err) {
    console.error(`❌ Direct Ollama call failed: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }

  console.log('⏳ Step 2/2: calling Reporter.generateReport (full pipeline path)...\n');
  const startMs = Date.now();

  const report = await reporter.generateReport({
    url: 'https://example-shop.test',
    appType: 'ecommerce',
    bugs: [fakeBug],
    events: [],
  });

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`✅ Reporter finished in ${elapsedSec}s\n`);

  const enriched = report.bugs[0];
  console.log('─── Reporter output ────────────────────────────────────────────────');
  console.log(`Bug:          ${enriched.bug.title}`);
  console.log(`Root cause:   ${enriched.rootCause}`);
  console.log(`Suggested fix: ${enriched.suggestedFix}`);
  console.log(`Repro steps:  ${(enriched.reproductionSteps ?? []).length} steps`);
  for (const step of enriched.reproductionSteps ?? []) {
    console.log(`              - ${step}`);
  }
  console.log('────────────────────────────────────────────────────────────────────');
  console.log(`Cost:         $${report.cost.estimatedUsd.toFixed(4)} (Ollama is local, so this should be $0)\n`);

  if (report.cost.estimatedUsd === 0 && enriched.rootCause && enriched.rootCause.length > 10) {
    console.log('🎉 Verified: Ollama (local LLM) produced a real structured analysis.\n');
  } else {
    console.warn('⚠️  Output looks empty or malformed. Ollama 3B sometimes drops the tool call — try running again.\n');
  }
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
