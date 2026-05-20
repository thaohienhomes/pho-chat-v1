import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { FileService } from '@/server/services/file';
import { ChatMessage, CreateMessageParams } from '@/types/message';
import { UpdateMessageRAGParams } from '@/types/message/rag';

import { messageRouter } from '../message';

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));

vi.mock('@/database/server', () => {
  const mockServerDB = {} as any;

  return {
    getServerDB: vi.fn().mockResolvedValue(mockServerDB),
    serverDB: mockServerDB,
  };
});

vi.mock('@/const/auth', () => ({
  enableClerk: true,
}));

describe('messageRouter', () => {
  it('should handle batchCreateMessages', async () => {
    const mockBatchCreate = vi.fn().mockResolvedValue({ rowCount: 2 });
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreate,
        }) as any,
    );

    const input = [
      {
        agentId: 'agent1',
        clientId: 'client1',
        content: 'test',
        createdAt: new Date(),
        error: null,
        favorite: false,
        id: '1',
        model: null,
        observationId: null,
        parentId: null,
        pluginState: null,
        provider: null,
        quotaId: null,
        reasoning: null,
        role: 'user',
        search: null,
        sessionId: 'session1',
        threadId: null,
        tools: null,
        topicId: null,
        traceId: null,
        translate: null,
        tts: null,
        updatedAt: new Date(),
        userId: 'user1',
      } as any,
    ];

    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.batchCreate(input);

    expect(mockBatchCreate).toHaveBeenCalledWith(input);
    expect(result.rowCount).toBe(2);
  });

  it('should handle count', async () => {
    const mockCount = vi.fn().mockResolvedValue(5);
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          count: mockCount,
        }) as any,
    );

    const input = { startDate: '2024-01-01' };
    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.count(input);

    expect(mockCount).toHaveBeenCalledWith(input);
    expect(result).toBe(5);
  });

  it('should handle createMessage', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'msg1' });
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          create: mockCreate,
        }) as any,
    );

    const input: CreateMessageParams = {
      content: 'test',
      role: 'user',
      sessionId: 'session1',
    };

    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.create(input);

    expect(mockCreate).toHaveBeenCalledWith(input);
    expect(result.id).toBe('msg1');
  });

  it('should handle getMessages', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: 'msg1' }]);
    const mockGetFullFileUrl = vi.fn().mockResolvedValue('url');

    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          query: mockQuery,
        }) as any,
    );

    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          getFullFileUrl: mockGetFullFileUrl,
        }) as any,
    );

    const input = { sessionId: 'session1' };
    const ctx = {
      fileService: new FileService({} as any, 'user1'),
      messageModel: new MessageModel({} as any, 'user1'),
      userId: 'user1',
    };

    const result = await ctx.messageModel.query(input, {
      postProcessUrl: mockGetFullFileUrl,
    });

    expect(mockQuery).toHaveBeenCalledWith(input, expect.any(Object));
    expect(result).toEqual([{ id: 'msg1' }]);
  });

  it('should handle getAllMessages', async () => {
    const mockQueryAll = vi.fn().mockResolvedValue([
      {
        id: 'msg1',
        meta: {},
      } as ChatMessage,
    ]);
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          queryAll: mockQueryAll,
        }) as any,
    );

    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.queryAll();

    expect(mockQueryAll).toHaveBeenCalled();
    expect(result).toEqual([{ id: 'msg1', meta: {} }]);
  });

  it('should handle removeMessage', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          deleteMessage: mockDelete,
        }) as any,
    );

    const input = { id: 'msg1' };
    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    await ctx.messageModel.deleteMessage(input.id);

    expect(mockDelete).toHaveBeenCalledWith(input.id);
  });

  it('should handle updateMessage', async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const input = { id: 'msg1', value: { content: 'updated' } };
    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.update(input.id, input.value);

    expect(mockUpdate).toHaveBeenCalledWith(input.id, input.value);
    expect(result).toEqual({ success: true });
  });

  it('should handle updateMessageRAG', async () => {
    const mockUpdateRAG = vi.fn().mockResolvedValue(undefined);
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          updateMessageRAG: mockUpdateRAG,
        }) as any,
    );

    const input = {
      id: 'msg1',
      value: { fileChunks: [{ id: 'c1', similarity: 0.9 }], ragQueryId: 'q1' },
    } as {
      id: string;
      value: UpdateMessageRAGParams;
    };

    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    await ctx.messageModel.updateMessageRAG(input.id, input.value);

    expect(mockUpdateRAG).toHaveBeenCalledWith('msg1', {
      fileChunks: [{ id: 'c1', similarity: 0.9 }],
      ragQueryId: 'q1',
    });
  });
});

describe('messageRouter.getMessages (PHO-260)', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws UNAUTHORIZED when ctx.userId is missing', async () => {
    // Before PHO-260 this returned an empty list even when the caller had
    // valid history — masking stale-Clerk-cookie races as "no messages".
    // The procedure must surface UNAUTHORIZED so retryOnUnauthorizedLink can
    // refresh the token before the user sees an empty conversation.
    const caller = messageRouter.createCaller({ userId: undefined } as any);

    await expect(caller.getMessages({})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('returns messages when authenticated', async () => {
    const mockMessages = [{ content: 'hi', id: 'msg1' }];
    const mockQuery = vi.fn().mockResolvedValue(mockMessages);
    const mockGetFullFileUrl = vi.fn();

    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          query: mockQuery,
        }) as any,
    );
    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          getFullFileUrl: mockGetFullFileUrl,
        }) as any,
    );

    const caller = messageRouter.createCaller({ userId } as any);
    const input = { sessionId: 's1', topicId: 't1' };
    const result = await caller.getMessages(input);

    expect(result).toEqual(mockMessages);
    expect(mockQuery).toHaveBeenCalledWith(input, expect.any(Object));
  });
});
