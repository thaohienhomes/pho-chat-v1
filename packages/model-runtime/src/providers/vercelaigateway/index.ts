import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { ModelProvider } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface VercelAIGatewayModelCard {
  context_window?: number;
  created?: number | string;
  description?: string;
  id: string;
  max_tokens?: number;
  name?: string;
  pricing?: {
    input?: string | number;
    output?: string | number;
  };
  tags?: string[];
  type?: string;
}

const formatPrice = (price?: string | number) => {
  if (price === undefined || price === null) return undefined;
  const n = typeof price === 'number' ? price : Number(price);
  if (Number.isNaN(n)) return undefined;
  // Convert per-token price (USD) to per million tokens
  return Number((n * 1e6).toPrecision(5));
};

export const LobeVercelAIGatewayAI = createOpenAICompatibleRuntime({
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, reasoning_effort, verbosity, enabledContextCaching = true, ...rest } = payload;

      const providerOptions: any = {};
      // Attach the static cost-attribution tag on SERVER calls only. Gateway
      // tag/user writes are billed by Vercel's Custom Reporting, and in
      // client-fetch (BYO-key) mode this handler runs in the user's browser
      // against THEIR gateway account — never spend their reporting budget or
      // pollute their dashboard with our app tag. The openaiCompatibleFactory
      // merges the per-request user id + feature/plan tags into this object
      // (ChatMethodOptions.user / .tags).
      if (typeof window === 'undefined') {
        providerOptions.gateway = { tags: ['app:pho-chat'] };
      }
      // Enable Vercel AI Gateway automatic prompt caching. The gateway inserts
      // cache_control markers on static prefixes (system prompt + earlier turns)
      // for providers that support it (e.g. Anthropic), and is a no-op otherwise.
      // This cuts input cost on long, repeated-prefix conversations.
      // Respect the user's context-caching opt-out (defaults on), matching the
      // native anthropic provider's `enabledContextCaching` behaviour.
      if (enabledContextCaching) {
        providerOptions.gateway = { ...providerOptions.gateway, caching: 'auto' };
      }
      if (reasoning_effort || verbosity) {
        providerOptions.openai = {};
        if (reasoning_effort) {
          providerOptions.openai.reasoningEffort = reasoning_effort;
          providerOptions.openai.reasoningSummary = 'auto';
        }
        if (verbosity) {
          providerOptions.openai.textVerbosity = verbosity;
        }
      }

      return {
        ...rest,
        model,
        providerOptions,
      } as any;
    },
  },
  constructorOptions: {
    defaultHeaders: {
      'http-referer': 'https://pho.chat',
      'x-title': 'pho.chat',
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_VERCELAIGATEWAY_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: VercelAIGatewayModelCard[] = modelsPage.data;

    const formattedModels = (modelList || []).map((m) => {
      const tags = Array.isArray(m.tags) ? m.tags : [];

      const inputPrice = formatPrice(m.pricing?.input);
      const outputPrice = formatPrice(m.pricing?.output);
      let displayName = m.name ?? m.id;
      if (inputPrice === 0 && outputPrice === 0) {
        displayName += ' (free)';
      }

      return {
        contextWindowTokens: m.context_window ?? undefined,
        created: m.created,
        description: m.description ?? '',
        displayName,
        functionCall: tags.includes('tool-use') || false,
        id: m.id,
        maxOutput: typeof m.max_tokens === 'number' ? m.max_tokens : undefined,
        pricing: {
          input: inputPrice,
          output: outputPrice,
        },
        reasoning: tags.includes('reasoning') || false,
        type: m.type === 'embedding' ? 'embedding' : 'chat',
        vision: tags.includes('vision') || false,
      } as any;
    });

    return await processMultiProviderModelList(formattedModels, 'vercelaigateway');
  },
  provider: ModelProvider.VercelAIGateway,
});
