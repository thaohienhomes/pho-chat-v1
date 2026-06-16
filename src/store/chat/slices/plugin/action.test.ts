import { act, renderHook } from '@testing-library/react';
import { Mock, afterEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { PLUGIN_SCHEMA_API_MD5_PREFIX, PLUGIN_SCHEMA_SEPARATOR } from '@/const/plugin';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { chatSelectors } from '@/store/chat/selectors';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useToolStore } from '@/store/tool';
import { ChatMessage, ChatToolPayload, MessageToolCall } from '@/types/message';
import { genToolCallShortMD5Hash } from '@/utils/toolCall';

const invokeStandaloneTypePlugin = useChatStore.getState().invokeStandaloneTypePlugin;

vi.mock('zustand/traditional');

// Mock messageService
vi.mock('@/services/message', () => ({
  messageService: {
    createMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageError: vi.fn(),
    updateMessagePluginArguments: vi.fn(),
    updateMessagePluginState: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChatPluginAction', () => {
  describe('summaryPluginContent', () => {
    it('should summarize plugin content', async () => {
      const messageId = 'message-id';
      const toolMessage = {
        content: 'Tool content to summarize',
        id: messageId,
        role: 'tool',
      } as ChatMessage;

      const internal_coreProcessMessageMock = vi.fn();

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          internal_coreProcessMessage: internal_coreProcessMessageMock,
          messagesMap: { [messageMapKey('session-id')]: [toolMessage] },
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.summaryPluginContent(messageId);
      });

      expect(internal_coreProcessMessageMock).toHaveBeenCalledWith(
        [
          {
            content: '作为一名总结专家，请结合以上系统提示词，将以下内容进行总结：',
            role: 'assistant',
          },
          {
            ...toolMessage,
            content: toolMessage.content,
            meta: {
              avatar: DEFAULT_INBOX_AVATAR,
              backgroundColor: 'rgba(0,0,0,0)',
              description: undefined,
              title: undefined,
            },
            name: undefined,
            role: 'assistant',
            tool_call_id: undefined,
          },
        ],
        messageId,
      );
    });

    it('should not summarize non-tool messages', async () => {
      const messageId = 'message-id';
      const nonToolMessage = {
        content: 'User message',
        id: messageId,
        role: 'user',
      } as ChatMessage;

      const internal_coreProcessMessageMock = vi.fn();

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          internal_coreProcessMessage: internal_coreProcessMessageMock,
          messagesMap: { [messageMapKey('session-id')]: [nonToolMessage] },
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.summaryPluginContent(messageId);
      });

      expect(internal_coreProcessMessageMock).not.toHaveBeenCalled();
    });
  });

  describe('internal_togglePluginApiCalling', () => {
    it('should toggle plugin API calling state', () => {
      const internal_toggleLoadingArraysMock = vi.fn();

      act(() => {
        useChatStore.setState({
          internal_toggleLoadingArrays: internal_toggleLoadingArraysMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const action = 'test-action';

      result.current.internal_togglePluginApiCalling(true, messageId, action);

      expect(internal_toggleLoadingArraysMock).toHaveBeenCalledWith(
        'pluginApiLoadingIds',
        true,
        messageId,
        action,
      );

      result.current.internal_togglePluginApiCalling(false, messageId, action);

      expect(internal_toggleLoadingArraysMock).toHaveBeenCalledWith(
        'pluginApiLoadingIds',
        false,
        messageId,
        action,
      );
    });
  });

  describe('fillPluginMessageContent', () => {
    it('should update message content and trigger the ai message', async () => {
      // 设置模拟函数的返回值
      const mockCurrentChats: any[] = [];
      vi.spyOn(chatSelectors, 'activeBaseChats').mockReturnValue(mockCurrentChats);

      // 设置初始状态
      const initialState = {
        internal_coreProcessMessage: vi.fn(),
        messages: [],
        refreshMessages: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.fillPluginMessageContent(messageId, newContent, true);
      });

      // 验证 messageService.internal_updateMessageContent 是否被正确调用
      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, { content: newContent });

      // 验证 refreshMessages 是否被调用
      expect(result.current.refreshMessages).toHaveBeenCalled();

      // 验证 coreProcessMessage 是否被正确调用
      expect(result.current.internal_coreProcessMessage).toHaveBeenCalledWith(
        mockCurrentChats,
        messageId,
        {},
      );
    });
    it('should update message content and not trigger ai message', async () => {
      // 设置模拟函数的返回值
      const mockCurrentChats: any[] = [];
      vi.spyOn(chatSelectors, 'activeBaseChats').mockReturnValue(mockCurrentChats);

      // 设置初始状态
      const initialState = {
        coreProcessMessage: vi.fn(),
        internal_coreProcessMessage: vi.fn(),
        messages: [],
        refreshMessages: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const newContent = 'Updated content';

      await act(async () => {
        await result.current.fillPluginMessageContent(messageId, newContent);
      });

      // 验证 messageService.internal_updateMessageContent 是否被正确调用
      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, { content: newContent });

      // 验证 refreshMessages 是否被调用
      expect(result.current.refreshMessages).toHaveBeenCalled();

      // 验证 coreProcessMessage 没有被正确调用
      expect(result.current.internal_coreProcessMessage).not.toHaveBeenCalled();
    });
  });

  describe('invokeDefaultTypePlugin', () => {
    it('should run the default plugin type and update message content', async () => {
      const pluginPayload = { apiName: 'testApi', arguments: { key: 'value' } };
      const messageId = 'message-id';
      const pluginApiResponse = 'Plugin API response';

      const storeState = useChatStore.getState();

      vi.spyOn(storeState, 'refreshMessages');
      vi.spyOn(storeState, 'triggerAIMessage').mockResolvedValue(undefined);
      vi.spyOn(storeState, 'internal_togglePluginApiCalling').mockReturnValue(undefined);

      const runSpy = vi.spyOn(chatService, 'runPluginApi').mockResolvedValue({
        text: pluginApiResponse,
        traceId: '',
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeDefaultTypePlugin(messageId, pluginPayload);
      });

      expect(storeState.internal_togglePluginApiCalling).toHaveBeenCalledWith(
        true,
        messageId,
        expect.any(String),
      );
      expect(runSpy).toHaveBeenCalledWith(pluginPayload, { signal: undefined, trace: {} });
      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, {
        content: pluginApiResponse,
      });
      expect(storeState.refreshMessages).toHaveBeenCalled();
      expect(storeState.internal_togglePluginApiCalling).toHaveBeenCalledWith(
        false,
        'message-id',
        'plugin/fetchPlugin/end',
      );
    });

    it('should handle errors when the plugin API call fails', async () => {
      const pluginPayload = { apiName: 'testApi', arguments: { key: 'value' } };
      const messageId = 'message-id';
      const error = new Error('API call failed');

      const storeState = useChatStore.getState();
      vi.spyOn(storeState, 'refreshMessages');
      vi.spyOn(storeState, 'triggerAIMessage').mockResolvedValue(undefined);
      vi.spyOn(storeState, 'internal_togglePluginApiCalling').mockReturnValue(undefined);

      vi.spyOn(chatService, 'runPluginApi').mockRejectedValue(error);

      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        await result.current.invokeDefaultTypePlugin(messageId, pluginPayload);
      });

      expect(storeState.internal_togglePluginApiCalling).toHaveBeenCalledWith(
        true,
        messageId,
        expect.any(String),
      );
      expect(chatService.runPluginApi).toHaveBeenCalledWith(pluginPayload, { trace: {} });
      expect(messageService.updateMessageError).toHaveBeenCalledWith(messageId, error);
      expect(storeState.refreshMessages).toHaveBeenCalled();
      expect(storeState.internal_togglePluginApiCalling).toHaveBeenCalledWith(
        false,
        'message-id',
        'plugin/fetchPlugin/end',
      );
      expect(storeState.triggerAIMessage).not.toHaveBeenCalled(); // 确保在错误情况下不调用此方法
    });
  });

  describe('triggerToolCalls', () => {
    it('should trigger tool calls for the assistant message', async () => {
      const assistantId = 'assistant-id';
      const message = {
        content: 'Assistant message',
        id: assistantId,
        role: 'assistant',
        tools: [
          {
            apiName: 'api1',
            arguments: '{}',
            id: 'tool1',
            identifier: 'plugin1',
            type: 'standalone',
          },
          {
            apiName: 'api2',
            arguments: '{}',
            id: 'tool2',
            identifier: 'plugin2',
            type: 'markdown',
          },
          {
            apiName: 'api3',
            arguments: '{}',
            id: 'tool3',
            identifier: 'builtin1',
            type: 'builtin',
          },
          {
            apiName: 'api4',
            arguments: '{}',
            id: 'tool4',
            identifier: 'plugin3',
            type: 'default',
          },
        ],
      } as ChatMessage;

      const invokeStandaloneTypePluginMock = vi.fn();
      const invokeMarkdownTypePluginMock = vi.fn();
      const invokeBuiltinToolMock = vi.fn();
      const invokeDefaultTypePluginMock = vi.fn().mockResolvedValue('Default tool response');
      const triggerAIMessageMock = vi.fn();
      const internal_createMessageMock = vi.fn().mockResolvedValue('tool-message-id');

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          activeTopicId: 'topic-id',
          internal_createMessage: internal_createMessageMock,
          invokeBuiltinTool: invokeBuiltinToolMock,
          invokeDefaultTypePlugin: invokeDefaultTypePluginMock,
          invokeMarkdownTypePlugin: invokeMarkdownTypePluginMock,
          invokeStandaloneTypePlugin: invokeStandaloneTypePluginMock,
          messagesMap: {
            [messageMapKey('session-id', 'topic-id')]: [message],
          },
          triggerAIMessage: triggerAIMessageMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.triggerToolCalls(assistantId);
      });

      // Verify that tool messages were created for each tool call
      expect(internal_createMessageMock).toHaveBeenCalledTimes(4);
      expect(internal_createMessageMock).toHaveBeenCalledWith({
        content: LOADING_FLAT,
        parentId: assistantId,
        plugin: message.tools![0],
        role: 'tool',
        sessionId: 'session-id',
        tool_call_id: 'tool1',
        topicId: 'topic-id',
      });
      // ... similar assertions for other tool calls

      // Verify that the appropriate plugin types were invoked
      expect(invokeStandaloneTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![0],
      );
      expect(invokeMarkdownTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![1],
      );
      expect(invokeBuiltinToolMock).toHaveBeenCalledWith('tool-message-id', message.tools![2]);
      expect(invokeDefaultTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![3],
      );

      // Verify that AI message was triggered for default type tool call
      // expect(getTraceIdByMessageIdMock).toHaveBeenCalledWith('tool-message-id');
      // expect(triggerAIMessageMock).toHaveBeenCalledWith({ traceId: 'trace-id' });
    });

    it('should not trigger AI message if no default type tool calls', async () => {
      const assistantId = 'assistant-id';
      const message = {
        content: 'Assistant message',
        id: assistantId,
        role: 'assistant',
        tools: [
          {
            apiName: 'api1',
            arguments: '{}',
            id: 'tool1',
            identifier: 'plugin1',
            type: 'standalone',
          },
          {
            apiName: 'api2',
            arguments: '{}',
            id: 'tool2',
            identifier: 'plugin2',
            type: 'markdown',
          },
          {
            apiName: 'api3',
            arguments: '{}',
            id: 'tool3',
            identifier: 'builtin1',
            type: 'builtin',
          },
        ],
      } as ChatMessage;

      const invokeStandaloneTypePluginMock = vi.fn();
      const invokeMarkdownTypePluginMock = vi.fn();
      const invokeBuiltinToolMock = vi.fn();
      const triggerAIMessageMock = vi.fn();
      const internal_createMessageMock = vi.fn().mockResolvedValue('tool-message-id');

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          activeTopicId: 'topic-id',
          internal_createMessage: internal_createMessageMock,
          invokeBuiltinTool: invokeBuiltinToolMock,
          invokeMarkdownTypePlugin: invokeMarkdownTypePluginMock,
          invokeStandaloneTypePlugin: invokeStandaloneTypePluginMock,
          messagesMap: {
            [messageMapKey('session-id', 'topic-id')]: [message],
          },
          triggerAIMessage: triggerAIMessageMock,
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.triggerToolCalls(assistantId);
      });

      // Verify that tool messages were created for each tool call
      expect(internal_createMessageMock).toHaveBeenCalledTimes(3);

      // Verify that the appropriate plugin types were invoked
      expect(invokeStandaloneTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![0],
      );
      expect(invokeMarkdownTypePluginMock).toHaveBeenCalledWith(
        'tool-message-id',
        message.tools![1],
      );
      expect(invokeBuiltinToolMock).toHaveBeenCalledWith('tool-message-id', message.tools![2]);

      // Verify that AI message was not triggered
      expect(triggerAIMessageMock).not.toHaveBeenCalled();
    });
  });

  describe('updatePluginState', () => {
    it('should update the plugin state for a message', async () => {
      const messageId = 'message-id';
      const pluginStateValue = { key: 'value' };

      const initialState = {
        refreshMessages: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.updatePluginState(messageId, pluginStateValue);
      });

      expect(messageService.updateMessagePluginState).toHaveBeenCalledWith(
        messageId,
        pluginStateValue,
      );
      expect(initialState.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('createAssistantMessageByPlugin', () => {
    it('should create an assistant message and refresh messages', async () => {
      // 模拟 messageService.create 方法的实现
      (messageService.createMessage as Mock).mockResolvedValue({});

      // 设置初始状态并模拟 refreshMessages 方法
      const initialState = {
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        refreshMessages: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const content = 'Test content';
      const parentId = 'parent-message-id';

      await act(async () => {
        await result.current.createAssistantMessageByPlugin(content, parentId);
      });

      // 验证 messageService.create 是否被带有正确参数调用
      expect(messageService.createMessage).toHaveBeenCalledWith({
        content,
        parentId,
        role: 'assistant',
        sessionId: initialState.activeId,
        topicId: initialState.activeTopicId,
      });

      // 验证 refreshMessages 是否被调用
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });

    it('should handle errors when message creation fails', async () => {
      // 模拟 messageService.create 方法，使其抛出错误
      const errorMessage = 'Failed to create message';
      (messageService.createMessage as Mock).mockRejectedValue(new Error(errorMessage));

      // 设置初始状态并模拟 refreshMessages 方法
      const initialState = {
        activeId: 'session-id',
        activeTopicId: 'topic-id',
        refreshMessages: vi.fn(),
      };
      useChatStore.setState(initialState);

      const { result } = renderHook(() => useChatStore());

      const content = 'Test content';
      const parentId = 'parent-message-id';

      await act(async () => {
        await expect(
          result.current.createAssistantMessageByPlugin(content, parentId),
        ).rejects.toThrow(errorMessage);
      });

      // 验证 messageService.create 是否被带有正确参数调用
      expect(messageService.createMessage).toHaveBeenCalledWith({
        content,
        parentId,
        role: 'assistant',
        sessionId: initialState.activeId,
        topicId: initialState.activeTopicId,
      });

      // 验证 refreshMessages 是否没有被调用
      expect(result.current.refreshMessages).not.toHaveBeenCalled();
    });
  });

  describe('invokeBuiltinTool', () => {
    it('should invoke a builtin tool and update message content ,then run text2image', async () => {
      const payload = {
        apiName: 'text2image',
        arguments: JSON.stringify({ key: 'value' }),
      } as ChatToolPayload;

      const messageId = 'message-id';
      const toolResponse = JSON.stringify({ abc: 'data' });

      useToolStore.setState({
        transformApiArgumentsToAiState: vi.fn().mockResolvedValue(toolResponse),
      });

      useChatStore.setState({
        internal_togglePluginApiCalling: vi.fn(),
        internal_updateMessageContent: vi.fn(),
        text2image: vi.fn(),
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeBuiltinTool(messageId, payload);
      });

      // Verify that the builtin tool was invoked with the correct arguments
      expect(useToolStore.getState().transformApiArgumentsToAiState).toHaveBeenCalledWith(
        payload.apiName,
        JSON.parse(payload.arguments),
      );

      // Verify that the message content was updated with the tool response
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        toolResponse,
      );

      // Verify that loading was toggled correctly
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenCalledTimes(2);

      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        1,
        true,
        messageId,
        expect.any(String),
      );
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        2,
        false,
        messageId,
        expect.any(String),
      );
      expect(useChatStore.getState().text2image).toHaveBeenCalled();
    });

    it('should invoke a builtin tool and update message content', async () => {
      const payload = {
        apiName: 'text2image',
        arguments: JSON.stringify({ key: 'value' }),
      } as ChatToolPayload;

      const messageId = 'message-id';
      const toolResponse = 'Builtin tool response';

      act(() => {
        useToolStore.setState({
          text2image: vi.fn(),
          transformApiArgumentsToAiState: vi.fn().mockResolvedValue(toolResponse),
        });

        useChatStore.setState({
          internal_togglePluginApiCalling: vi.fn(),
          internal_updateMessageContent: vi.fn(),
          text2image: vi.fn(),
        });
      });
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeBuiltinTool(messageId, payload);
      });

      // Verify that the builtin tool was invoked with the correct arguments
      expect(useToolStore.getState().transformApiArgumentsToAiState).toHaveBeenCalledWith(
        payload.apiName,
        JSON.parse(payload.arguments),
      );

      // Verify that the message content was updated with the tool response
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenCalledTimes(2);
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        toolResponse,
      );

      // Verify that loading was toggled correctly
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        1,
        true,
        messageId,
        expect.any(String),
      );
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        2,
        false,
        messageId,
        expect.any(String),
      );
      expect(useChatStore.getState().text2image).not.toHaveBeenCalled();
    });

    it('should handle errors when transformApiArgumentsToAiState throw error', async () => {
      const args = { key: 'value' };
      const payload = {
        apiName: 'builtinApi',
        arguments: JSON.stringify(args),
      } as ChatToolPayload;

      const messageId = 'message-id';

      useToolStore.setState({
        transformApiArgumentsToAiState: vi
          .fn()
          .mockRejectedValue({ error: 'transformApiArgumentsToAiState throw error' }),
      });

      useChatStore.setState({
        internal_togglePluginApiCalling: vi.fn(),
        internal_updateMessageContent: vi.fn(),
        internal_updatePluginError: vi.fn(),
        refreshMessages: vi.fn(),
        text2image: vi.fn(),
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeBuiltinTool(messageId, payload);
      });

      expect(result.current.internal_updatePluginError).toHaveBeenCalledWith('message-id', {
        body: {
          arguments: args,
          message: expect.any(String),
          schema: undefined,
          stack: undefined,
        },
        message: expect.any(String),
        type: 'PluginFailToTransformArguments',
      });
      // Verify that loading was toggled correctly
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        1,
        true,
        messageId,
        expect.any(String),
      );
      expect(result.current.internal_togglePluginApiCalling).toHaveBeenNthCalledWith(
        2,
        false,
        messageId,
        expect.any(String),
      );

      // Verify that the message content was not updated
      expect(result.current.internal_updateMessageContent).not.toHaveBeenCalled();

      // Verify that messages were not refreshed
      expect(useChatStore.getState().text2image).not.toHaveBeenCalled();
    });
  });

  describe('invokeMarkdownTypePlugin', () => {
    it('should invoke a markdown type plugin', async () => {
      const payload = {
        apiName: 'markdownApi',
        arguments: JSON.stringify({ key: 'value' }),
        identifier: 'abc',
        type: 'markdown',
      } as ChatToolPayload;
      const messageId = 'message-id';

      const runPluginApiMock = vi.fn();

      act(() => {
        useChatStore.setState({ internal_callPluginApi: runPluginApiMock });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeMarkdownTypePlugin(messageId, payload);
      });

      // Verify that the markdown type plugin was invoked
      expect(runPluginApiMock).toHaveBeenCalledWith(messageId, payload);
    });
  });

  describe('invokeStandaloneTypePlugin', () => {
    it('should update message with error and refresh messages if plugin settings are invalid', async () => {
      const messageId = 'message-id';

      const payload = {
        identifier: 'pluginName',
      } as ChatToolPayload;

      act(() => {
        useToolStore.setState({
          validatePluginSettings: vi
            .fn()
            .mockResolvedValue({ errors: ['Invalid setting'], valid: false }),
        });

        useChatStore.setState({ invokeStandaloneTypePlugin, refreshMessages: vi.fn() });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.invokeStandaloneTypePlugin(messageId, payload);
      });

      const call = vi.mocked(messageService.updateMessageError).mock.calls[0];

      expect(call[1]).toEqual({
        body: {
          error: ['Invalid setting'],
          message: '[plugin] your settings is invalid with plugin manifest setting schema',
        },
        message: undefined,
        type: 'PluginSettingsInvalid',
      });

      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('reInvokeToolMessage', () => {
    it('should re-invoke a tool message', async () => {
      const messageId = 'message-id';
      const message = {
        content: 'Original content',
        id: messageId,
        plugin: {
          apiName: 'api-name',
          arguments: '{}',
          identifier: 'plugin-id',
          type: 'default',
        },
        role: 'tool',
        tool_call_id: 'tool-id',
      } as ChatMessage;

      const internal_invokeDifferentTypePluginMock = vi.fn();
      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          internal_invokeDifferentTypePlugin: internal_invokeDifferentTypePluginMock,
          internal_updateMessageError: vi.fn(),
          messagesMap: { [messageMapKey('session-id')]: [message] },
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.reInvokeToolMessage(messageId);
      });

      expect(internal_invokeDifferentTypePluginMock).toHaveBeenCalledWith(
        messageId,
        expect.objectContaining(message.plugin),
      );
    });

    it('should clear error content when re-invoking', async () => {
      const messageId = 'message-id';
      const message = {
        content: 'Original content',
        id: messageId,
        plugin: {
          apiName: 'api-name',
          arguments: '{}',
          identifier: 'plugin-id',
          type: 'default',
        },
        pluginError: { message: 'Previous error', type: 'ProviderBizError' },
        role: 'tool',
        tool_call_id: 'tool-id',
      } as ChatMessage;

      const internal_updateMessageErrorMock = vi.fn();

      act(() => {
        useChatStore.setState({
          activeId: 'session-id',
          internal_invokeDifferentTypePlugin: vi.fn(),
          internal_updateMessagePluginError: internal_updateMessageErrorMock,
          messagesMap: { [messageMapKey('session-id')]: [message] },
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.reInvokeToolMessage(messageId);
      });

      expect(internal_updateMessageErrorMock).toHaveBeenCalledWith(messageId, null);
    });
  });

  describe('updatePluginArguments', () => {
    it('should update plugin arguments and refresh messages', async () => {
      const messageId = 'message-id';
      const toolCallId = 'tool-call-id';
      const parentId = 'parent-id';
      const identifier = 'plugin';
      const newArguments = { newKey: 'newValue' };

      const toolMessage = {
        content: 'Tool content',
        id: messageId,
        parentId,
        plugin: { arguments: '{"oldKey":"oldValue"}', identifier: identifier },
        role: 'tool',
        tool_call_id: toolCallId,
      } as ChatMessage;

      const assistantMessage = {
        content: 'Assistant content',
        id: parentId,
        role: 'assistant',
        tools: [{ arguments: '{"oldKey":"oldValue"}', id: toolCallId, identifier: identifier }],
      } as ChatMessage;

      act(() => {
        useChatStore.setState({
          activeId: 'anbccfdd',
          messagesMap: { [messageMapKey('anbccfdd')]: [assistantMessage, toolMessage] },
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.updatePluginArguments(messageId, newArguments);
      });

      expect(messageService.updateMessagePluginArguments).toHaveBeenCalledWith(
        messageId,
        expect.objectContaining(newArguments),
      );
      // TODO: 需要验证 updateMessage 是否被调用
      // expect(messageService.updateMessage).toHaveBeenCalledWith(
      //   parentId,
      //   expect.objectContaining({ tools: expect.any(Array) }),
      // );
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('internal_callPluginApi', () => {
    it('should call plugin API and update message content', async () => {
      const messageId = 'message-id';
      const payload: ChatToolPayload = {
        apiName: 'api-name',
        arguments: '{}',
        id: 'tool-id',
        identifier: 'plugin-id',
        type: 'default',
      };
      const apiResponse = 'API response';

      vi.spyOn(chatService, 'runPluginApi').mockResolvedValue({
        text: apiResponse,
        traceId: 'trace-id',
      });

      act(() => {
        useChatStore.setState({
          internal_togglePluginApiCalling: vi.fn(),
          internal_updateMessageContent: vi.fn(),
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.internal_callPluginApi(messageId, payload);
      });

      expect(chatService.runPluginApi).toHaveBeenCalledWith(payload, expect.any(Object));
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        apiResponse,
      );
      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, { traceId: 'trace-id' });
    });

    it('should handle API call errors', async () => {
      const messageId = 'message-id';
      const payload: ChatToolPayload = {
        apiName: 'api-name',
        arguments: '{}',
        id: 'tool-id',
        identifier: 'plugin-id',
        type: 'default',
      };
      const error = new Error('API call failed');

      vi.spyOn(chatService, 'runPluginApi').mockRejectedValue(error);

      act(() => {
        useChatStore.setState({
          internal_togglePluginApiCalling: vi.fn(),
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.internal_callPluginApi(messageId, payload);
      });

      expect(messageService.updateMessageError).toHaveBeenCalledWith(messageId, error);
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('internal_transformToolCalls', () => {
    it('should transform tool calls correctly', () => {
      const toolCalls: MessageToolCall[] = [
        {
          function: {
            arguments: '{}',
            name: ['plugin1', 'api1', 'default'].join(PLUGIN_SCHEMA_SEPARATOR),
          },
          id: 'tool1',
          type: 'function',
        },
        {
          function: {
            arguments: '{}',
            name: ['plugin2', 'api2', 'markdown'].join(PLUGIN_SCHEMA_SEPARATOR),
          },
          id: 'tool2',
          type: 'function',
        },
      ];

      const { result } = renderHook(() => useChatStore());

      const transformed = result.current.internal_transformToolCalls(toolCalls);

      expect(transformed).toEqual([
        {
          apiName: 'api1',
          arguments: '{}',
          id: 'tool1',
          identifier: 'plugin1',
          type: 'default',
        },
        {
          apiName: 'api2',
          arguments: '{}',
          id: 'tool2',
          identifier: 'plugin2',
          type: 'markdown',
        },
      ]);
    });

    it('should handle MD5 hashed API names', () => {
      const apiName = 'testApi';
      const md5Hash = genToolCallShortMD5Hash(apiName);
      const toolCalls: MessageToolCall[] = [
        {
          function: {
            arguments: '{}',
            name: ['plugin1', PLUGIN_SCHEMA_API_MD5_PREFIX + md5Hash, 'default'].join(
              PLUGIN_SCHEMA_SEPARATOR,
            ),
          },
          id: 'tool1',
          type: 'function',
        },
      ];

      act(() => {
        useToolStore.setState({
          installedPlugins: [
            {
              identifier: 'plugin1',
              manifest: {
                api: [
                  {
                    description: 'abc',
                    name: apiName,
                    parameters: { properties: {}, type: 'object' },
                  },
                ],
                identifier: 'plugin1',
                type: 'default',
              } as any,
              type: 'plugin',
            },
          ],
        });
      });

      const { result } = renderHook(() => useChatStore());

      const transformed = result.current.internal_transformToolCalls(toolCalls);

      expect(transformed[0].apiName).toBe(apiName);
    });
  });

  describe('internal_updatePluginError', () => {
    it('should update plugin error and refresh messages', async () => {
      const messageId = 'message-id';
      const error = { message: 'Plugin error' } as any;

      act(() => {
        useChatStore.setState({
          refreshMessages: vi.fn(),
        });
      });

      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.internal_updatePluginError(messageId, error);
      });

      expect(messageService.updateMessage).toHaveBeenCalledWith(messageId, { error });
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('internal_addToolToAssistantMessage', () => {
    it('should add too to assistant messages', async () => {
      const { result } = renderHook(() => useChatStore());

      const messageId = 'message-id';
      const toolCallId = 'tool-call-id';
      const identifier = 'plugin';

      const refreshToUpdateMessageToolsSpy = vi.spyOn(
        result.current,
        'internal_refreshToUpdateMessageTools',
      );

      const assistantMessage = {
        content: 'Assistant content',
        id: messageId,
        role: 'assistant',
        tools: [{ arguments: '{"oldKey":"oldValue"}', id: toolCallId, identifier: identifier }],
      } as ChatMessage;

      act(() => {
        useChatStore.setState({
          activeId: 'anbccfdd',
          messagesMap: { [messageMapKey('anbccfdd')]: [assistantMessage] },
          refreshMessages: vi.fn(),
        });
      });

      await act(async () => {
        await result.current.internal_addToolToAssistantMessage(messageId, {
          apiName: 'test',
          arguments: '{"oldKey":"oldValue"}',
          id: 'newId',
          identifier,
          type: 'default',
        });
      });

      expect(refreshToUpdateMessageToolsSpy).toHaveBeenCalledWith(messageId);
    });
  });
});
