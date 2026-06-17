import { act, renderHook } from '@testing-library/react';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchService } from '@/services/search';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { CRAWL_CONTENT_LIMITED_COUNT } from '@/tools/web-browsing/const';
import { ChatMessage } from '@/types/message';
import { SearchContent, SearchQuery, UniformSearchResponse } from '@/types/tool/search';

// Mock services
vi.mock('@/services/search', () => ({
  searchService: {
    crawlPages: vi.fn(),
    search: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    getMessageById: vi.fn(),
  },
}));

function mockGetMessageById(message: ChatMessage | undefined) {
  return function getMessageByIdImpl() {
    return function selectMessage() {
      return message;
    };
  };
}

describe('search actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      activeId: 'session-id',
      activeTopicId: 'topic-id',
      internal_addToolToAssistantMessage: vi.fn(),
      internal_createMessage: vi.fn(),
      internal_updateMessageContent: vi.fn(),
      internal_updateMessagePluginError: vi.fn(),
      openToolUI: vi.fn(),
      searchLoading: {},
      updatePluginArguments: vi.fn(),
      updatePluginState: vi.fn(),
    });
  });

  describe('search', () => {
    it('should handle successful search', async () => {
      const mockResponse: UniformSearchResponse = {
        costTime: 1,
        query: 'test',
        resultNumbers: 1,
        results: [
          {
            category: 'general',
            content: 'Test Content',
            engines: ['google'],
            parsedUrl: 'test.com',
            score: 1,
            title: 'Test Result',
            url: 'https://test.com',
          },
        ],
      };

      (searchService.search as Mock).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useChatStore());
      const { search } = result.current;

      const messageId = 'test-message-id';
      const query: SearchQuery = {
        query: 'test query',
        searchEngines: ['google'],
      };

      await act(async () => {
        await search(messageId, query);
      });

      const expectedContent: SearchContent[] = [
        {
          content: 'Test Content',
          title: 'Test Result',
          url: 'https://test.com',
        },
      ];

      expect(searchService.search).toHaveBeenCalledWith('test query', {
        searchEngines: ['google'],
      });
      expect(result.current.searchLoading[messageId]).toBe(false);
      // Compare the parsed payload rather than the exact JSON string, so the
      // assertion does not depend on object key ordering.
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledTimes(1);
      const [calledMessageId, calledContent] = (
        result.current.internal_updateMessageContent as Mock
      ).mock.calls[0];
      expect(calledMessageId).toBe(messageId);
      expect(JSON.parse(calledContent)).toEqual(expectedContent);
    });

    it('should handle empty search results and retry with default engine', async () => {
      const emptyResponse: UniformSearchResponse = {
        costTime: 1,
        query: 'test',
        resultNumbers: 0,
        results: [],
      };

      const retryResponse: UniformSearchResponse = {
        costTime: 1,
        query: 'test',
        resultNumbers: 1,
        results: [
          {
            category: 'general',
            content: 'Retry Content',
            engines: ['google'],
            parsedUrl: 'retry.com',
            score: 1,
            title: 'Retry Result',
            url: 'https://retry.com',
          },
        ],
      };

      (searchService.search as Mock)
        .mockResolvedValueOnce(emptyResponse)
        .mockResolvedValueOnce(emptyResponse)
        .mockResolvedValueOnce(retryResponse);

      const { result } = renderHook(() => useChatStore());
      const { search } = result.current;

      const messageId = 'test-message-id';
      const query: SearchQuery = {
        query: 'test query',
        searchEngines: ['custom-engine'],
        searchTimeRange: 'year',
      };

      await act(async () => {
        await search(messageId, query);
      });

      expect(searchService.search).toHaveBeenCalledTimes(3);
      expect(searchService.search).toHaveBeenNthCalledWith(1, 'test query', {
        searchEngines: ['custom-engine'],
        searchTimeRange: 'year',
      });
      expect(searchService.search).toHaveBeenNthCalledWith(2, 'test query', {
        searchTimeRange: 'year',
      });
      expect(result.current.updatePluginArguments).toHaveBeenCalledWith(messageId, {
        query: 'test query',
      });
      expect(searchService.search).toHaveBeenNthCalledWith(3, 'test query');
      expect(result.current.updatePluginArguments).toHaveBeenCalledWith(messageId, {
        optionalParams: undefined,
        query: 'test query',
      });
    });

    it('should handle search error', async () => {
      const error = new Error('Search failed');
      (searchService.search as Mock).mockRejectedValue(error);

      const { result } = renderHook(() => useChatStore());
      const { search } = result.current;

      const messageId = 'test-message-id';
      const query: SearchQuery = {
        query: 'test query',
      };

      await act(async () => {
        await search(messageId, query);
      });

      expect(result.current.internal_updateMessagePluginError).toHaveBeenCalledWith(messageId, {
        body: error,
        message: 'Search failed',
        type: 'PluginServerError',
      });
      expect(result.current.searchLoading[messageId]).toBe(false);
    });
  });

  describe('crawlMultiPages', () => {
    it('should truncate content that exceeds limit', async () => {
      const longContent = 'a'.repeat(CRAWL_CONTENT_LIMITED_COUNT + 1000);
      const mockResponse = {
        results: [
          {
            crawler: 'naive',
            data: {
              content: longContent,
              title: 'Test Page',
            },
            originalUrl: 'https://test.com',
          },
        ],
      };

      (searchService.crawlPages as Mock).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useChatStore());
      const messageId = 'test-message-id';

      await act(async () => {
        await result.current.crawlMultiPages(messageId, { urls: ['https://test.com'] });
      });

      const expectedContent = [
        {
          content: longContent.slice(0, CRAWL_CONTENT_LIMITED_COUNT),
          title: 'Test Page',
        },
      ];

      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        JSON.stringify(expectedContent),
      );
    });

    it('should handle crawl errors', async () => {
      const mockResponse = {
        results: [
          {
            errorMessage: 'Failed to crawl',
            errorType: 'CRAWL_ERROR',
            originalUrl: 'https://test.com',
          },
        ],
      };

      (searchService.crawlPages as Mock).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useChatStore());
      const messageId = 'test-message-id';

      await act(async () => {
        await result.current.crawlMultiPages(messageId, { urls: ['https://test.com'] });
      });

      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        JSON.stringify(mockResponse.results),
      );
    });
  });

  describe('reSearchWithSearXNG', () => {
    it('should update arguments and perform search', async () => {
      const { result } = renderHook(() => useChatStore());
      const spy = vi.spyOn(result.current, 'search');
      const { triggerSearchAgain } = result.current;

      const messageId = 'test-message-id';
      const query: SearchQuery = {
        query: 'test query',
      };

      await act(async () => {
        await triggerSearchAgain(messageId, query, { aiSummary: true });
      });

      expect(result.current.updatePluginArguments).toHaveBeenCalledWith(messageId, query);
      expect(spy).toHaveBeenCalledWith(messageId, query, true);
    });
  });

  describe('saveSearXNGSearchResult', () => {
    it('should save search result as tool message', async () => {
      const messageId = 'test-message-id';
      const parentId = 'parent-message-id';
      const mockMessage: Partial<ChatMessage> = {
        content: 'test content',
        createdAt: Date.now(),
        id: messageId,
        meta: {},
        parentId,
        plugin: {
          apiName: 'search',
          arguments: '{}',
          identifier: 'search',
          type: 'default',
        },
        pluginState: {},
        role: 'assistant',
        updatedAt: Date.now(),
      };

      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        mockGetMessageById(mockMessage as ChatMessage),
      );

      const { result } = renderHook(() => useChatStore());
      const { saveSearchResult } = result.current;

      await act(async () => {
        await saveSearchResult(messageId);
      });

      expect(result.current.internal_createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'test content',
          parentId,
          plugin: mockMessage.plugin,
          pluginState: mockMessage.pluginState,
          role: 'tool',
        }),
      );

      expect(result.current.internal_addToolToAssistantMessage).toHaveBeenCalledWith(
        parentId,
        expect.objectContaining({
          identifier: 'search',
          type: 'default',
        }),
      );
    });

    it('should not save if message not found', async () => {
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(mockGetMessageById(undefined));

      const { result } = renderHook(() => useChatStore());
      const { saveSearchResult } = result.current;

      await act(async () => {
        await saveSearchResult('non-existent-id');
      });

      expect(result.current.internal_createMessage).not.toHaveBeenCalled();
      expect(result.current.internal_addToolToAssistantMessage).not.toHaveBeenCalled();
    });
  });

  describe('toggleSearchLoading', () => {
    it('should toggle search loading state', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'test-message-id';

      act(() => {
        result.current.toggleSearchLoading(messageId, true);
      });

      expect(result.current.searchLoading[messageId]).toBe(true);

      act(() => {
        result.current.toggleSearchLoading(messageId, false);
      });

      expect(result.current.searchLoading[messageId]).toBe(false);
    });
  });
});
