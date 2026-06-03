import { contextCachingModels, thinkingWithToolClaudeModels } from '@/const/models';
import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_SEARCH_FC_MODEL } from '@/const/settings';
import { AgentStoreState } from '@/store/agent/initialState';
import { LobeAgentChatConfig } from '@/types/agent';

import { currentAgentConfig } from './agent';

export const currentAgentChatConfig = (s: AgentStoreState): LobeAgentChatConfig =>
  currentAgentConfig(s).chatConfig || {};

const agentSearchMode = (s: AgentStoreState) => currentAgentChatConfig(s).searchMode || 'off';
const isAgentEnableSearch = (s: AgentStoreState) => agentSearchMode(s) !== 'off';

const useModelBuiltinSearch = (s: AgentStoreState) =>
  currentAgentChatConfig(s).useModelBuiltinSearch;

const searchFCModel = (s: AgentStoreState) =>
  currentAgentChatConfig(s).searchFCModel || DEFAULT_AGENT_SEARCH_FC_MODEL;

// 上下文缓存模型的历史上限。缓存让重复前缀变得很便宜，所以不按普通 historyCount
// 截断，而是携带（近乎）完整历史；但仍用一个较高的上限兜底，避免超长会话导致
// token 成本与延迟失控。只有超过该上限的会话才会被裁剪到最近的消息（更早的轮次
// 仍由历史摘要覆盖）。
const MAX_CONTEXT_CACHING_HISTORY_COUNT = 120;

// 是否为「开启上下文缓存且命中缓存模型」——此前这种情况会携带完整历史。
const isContextCachingFullHistory = (s: AgentStoreState) => {
  const config = currentAgentConfig(s);
  const chatConfig = currentAgentChatConfig(s);
  const enableContextCaching = !chatConfig.disableContextCaching;

  return enableContextCaching && contextCachingModels.has(config.model);
};

const enableHistoryCount = (s: AgentStoreState) => {
  const config = currentAgentConfig(s);
  const chatConfig = currentAgentChatConfig(s);

  // 缓存模型：仍开启历史计数，但用高上限（见 historyCount）兜底，避免无上限的超长上下文
  if (isContextCachingFullHistory(s)) return true;

  // 当开启搜索时，针对 claude 3.7 sonnet 模型不开启历史记录
  const enableSearch = isAgentEnableSearch(s);

  if (enableSearch && thinkingWithToolClaudeModels.has(config.model)) return false;

  return chatConfig.enableHistoryCount;
};

const historyCount = (s: AgentStoreState): number => {
  const chatConfig = currentAgentChatConfig(s);

  // 缓存模型使用高上限而非用户的 historyCount（后者面向非缓存截断），
  // 在保留缓存收益的同时给成本兜底。
  if (isContextCachingFullHistory(s)) return MAX_CONTEXT_CACHING_HISTORY_COUNT;

  return chatConfig.historyCount ?? (DEFAULT_AGENT_CHAT_CONFIG.historyCount as number); // historyCount 为 0 即不携带历史消息
};

const displayMode = (s: AgentStoreState) => {
  const chatConfig = currentAgentChatConfig(s);

  return chatConfig.displayMode || 'chat';
};

const enableHistoryDivider =
  (historyLength: number, currentIndex: number) => (s: AgentStoreState) => {
    const config = currentAgentChatConfig(s);

    return (
      enableHistoryCount(s) &&
      historyLength > (config.historyCount ?? 0) &&
      config.historyCount === historyLength - currentIndex
    );
  };

const isMemoryEnabled = (s: AgentStoreState) =>
  currentAgentChatConfig(s).memory?.enabled ?? false;

const memoryEffort = (s: AgentStoreState) =>
  currentAgentChatConfig(s).memory?.effort ?? 'medium';

const memoryConfig = (s: AgentStoreState) => currentAgentChatConfig(s).memory;

export const agentChatConfigSelectors = {
  agentSearchMode,
  currentChatConfig: currentAgentChatConfig,
  displayMode,
  enableHistoryCount,
  enableHistoryDivider,
  historyCount,
  isAgentEnableSearch,
  isMemoryEnabled,
  memoryConfig,
  memoryEffort,
  searchFCModel,
  useModelBuiltinSearch,
};
