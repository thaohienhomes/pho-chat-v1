'use client';

import { useFeatureFlagEnabled } from 'posthog-js/react';
import { useMemo } from 'react';

import {
  Ai21ProviderCard,
  Ai302ProviderCard,
  Ai360ProviderCard,
  AkashChatProviderCard,
  AnthropicProviderCard,
  BaichuanProviderCard,
  CohereProviderCard,
  DeepSeekProviderCard,
  FireworksAIProviderCard,
  GiteeAIProviderCard,
  GoogleProviderCard,
  GroqProviderCard,
  HigressProviderCard,
  HunyuanProviderCard,
  InfiniAIProviderCard,
  InternLMProviderCard,
  JinaProviderCard,
  MinimaxProviderCard,
  MistralProviderCard,
  MoonshotProviderCard,
  NovitaProviderCard,
  NvidiaProviderCard,
  OllamaCloudProviderCard,
  PPIOProviderCard,
  PerplexityProviderCard,
  QiniuProviderCard,
  QwenProviderCard,
  SambaNovaProviderCard,
  Search1APIProviderCard,
  SenseNovaProviderCard,
  SiliconCloudProviderCard,
  SparkProviderCard,
  StepfunProviderCard,
  TaichuProviderCard,
  TogetherAIProviderCard,
  UpstageProviderCard,
  V0ProviderCard,
  VLLMProviderCard,
  WenxinProviderCard,
  XAIProviderCard,
  XinferenceProviderCard,
  ZeroOneProviderCard,
  ZhiPuProviderCard,
} from '@/config/modelProviders';

import { ProviderItem } from '../type';
import { useAzureProvider } from './Azure';
import { useBedrockProvider } from './Bedrock';
import { useCloudflareProvider } from './Cloudflare';
import { useGithubProvider } from './Github';
import { useHuggingFaceProvider } from './HuggingFace';
import { useOllamaProvider } from './Ollama';
import { useOpenAIProvider } from './OpenAI';

/**
 * Hook to filter providers based on PostHog feature flags.
 * Checks both individual provider flags and group flags.
 */
const useFilteredProviders = (providers: ProviderItem[]): ProviderItem[] => {
  // TODO(PCFIX-1): each useFeatureFlagEnabled() below emits a `$feature_flag_called`
  // event. This is INTENTIONALLY left as-is: it runs only on the settings/llm page,
  // not the per-load chat path that PCFIX-1 fixed (see usePostHogFeatureFlags, which
  // reads the consolidated variants map instead). If this filtering ever moves onto a
  // hot path, consolidate these the same way to avoid re-introducing the flag burst.
  // Check group flags
  const premiumEnabled = useFeatureFlagEnabled('llm-group-premium');
  const fastEnabled = useFeatureFlagEnabled('llm-group-fast');
  const openSourceEnabled = useFeatureFlagEnabled('llm-group-open-source');
  const chinaEnabled = useFeatureFlagEnabled('llm-group-china');
  const aggregatorsEnabled = useFeatureFlagEnabled('llm-group-aggregators');

  // Check individual provider flags (add more as needed)
  const groqEnabled = useFeatureFlagEnabled('llm-provider-groq');
  const googleEnabled = useFeatureFlagEnabled('llm-provider-google');
  const openaiEnabled = useFeatureFlagEnabled('llm-provider-openai');
  const anthropicEnabled = useFeatureFlagEnabled('llm-provider-anthropic');
  const deepseekEnabled = useFeatureFlagEnabled('llm-provider-deepseek');

  return useMemo(() => {
    return providers.filter((provider) => {
      const id = provider.id.toLowerCase();

      // Individual flag check (takes precedence)
      if (id === 'groq' && groqEnabled === false) return false;
      if (id === 'google' && googleEnabled === false) return false;
      if (id === 'openai' && openaiEnabled === false) return false;
      if (id === 'anthropic' && anthropicEnabled === false) return false;
      if (id === 'deepseek' && deepseekEnabled === false) return false;

      // Group flag check
      const premiumProviders = ['openai', 'anthropic', 'google'];
      const fastProviders = ['groq', 'cerebras', 'sambanova'];
      const openSourceProviders = ['ollama', 'vllm', 'huggingface', 'xinference'];
      const chinaProviders = [
        'qwen',
        'zhipu',
        'deepseek',
        'baichuan',
        'moonshot',
        'hunyuan',
        'spark',
        'wenxin',
      ];
      const aggregatorProviders = ['togetherai', 'fireworksai'];

      if (premiumProviders.includes(id) && premiumEnabled === false) return false;
      if (fastProviders.includes(id) && fastEnabled === false) return false;
      if (openSourceProviders.includes(id) && openSourceEnabled === false) return false;
      if (chinaProviders.includes(id) && chinaEnabled === false) return false;
      if (aggregatorProviders.includes(id) && aggregatorsEnabled === false) return false;

      return true;
    });
  }, [
    providers,
    premiumEnabled,
    fastEnabled,
    openSourceEnabled,
    chinaEnabled,
    aggregatorsEnabled,
    groqEnabled,
    googleEnabled,
    openaiEnabled,
    anthropicEnabled,
    deepseekEnabled,
  ]);
};

export const useProviderList = (): ProviderItem[] => {
  const AzureProvider = useAzureProvider();
  const OllamaProvider = useOllamaProvider();
  const OpenAIProvider = useOpenAIProvider();
  const BedrockProvider = useBedrockProvider();
  const CloudflareProvider = useCloudflareProvider();
  const GithubProvider = useGithubProvider();
  const HuggingFaceProvider = useHuggingFaceProvider();

  const allProviders = useMemo(
    () => [
      OpenAIProvider,
      AzureProvider,
      OllamaProvider,
      VLLMProviderCard,
      XinferenceProviderCard,
      AnthropicProviderCard,
      BedrockProvider,
      GoogleProviderCard,
      DeepSeekProviderCard,
      HuggingFaceProvider,
      CloudflareProvider,
      GithubProvider,
      NovitaProviderCard,
      TogetherAIProviderCard,
      FireworksAIProviderCard,
      GroqProviderCard,
      NvidiaProviderCard,
      PerplexityProviderCard,
      MistralProviderCard,
      Ai21ProviderCard,
      UpstageProviderCard,
      XAIProviderCard,
      JinaProviderCard,
      SambaNovaProviderCard,
      Search1APIProviderCard,
      CohereProviderCard,
      V0ProviderCard,
      QiniuProviderCard,
      QwenProviderCard,
      WenxinProviderCard,
      HunyuanProviderCard,
      SparkProviderCard,
      ZhiPuProviderCard,
      ZeroOneProviderCard,
      SenseNovaProviderCard,
      StepfunProviderCard,
      MoonshotProviderCard,
      BaichuanProviderCard,
      MinimaxProviderCard,
      Ai360ProviderCard,
      TaichuProviderCard,
      InternLMProviderCard,
      SiliconCloudProviderCard,
      HigressProviderCard,
      GiteeAIProviderCard,
      PPIOProviderCard,
      InfiniAIProviderCard,
      AkashChatProviderCard,
      Ai302ProviderCard,
      OllamaCloudProviderCard,
    ],
    [
      AzureProvider,
      OllamaProvider,
      OpenAIProvider,
      BedrockProvider,
      CloudflareProvider,
      GithubProvider,
      HuggingFaceProvider,
    ],
  );

  return useFilteredProviders(allProviders);
};
