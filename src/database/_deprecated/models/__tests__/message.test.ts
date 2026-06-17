import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatMessage } from '@/types/message';

import { CreateMessageParams, MessageModel } from '../message';

describe('MessageModel', () => {
  let messageData: CreateMessageParams;

  beforeEach(() => {
    // 设置正确结构的消息数据
    messageData = {
      content: 'Test message content',
      role: 'user',
      sessionId: 'session1',
      topicId: 'topic1',
    };
  });

  afterEach(async () => {
    // 每次测试后清理数据库
    await MessageModel.clearTable();
  });

  describe('create', () => {
    it('should create a message record', async () => {
      const result = await MessageModel.create(messageData);

      expect(result).toHaveProperty('id');
      // 验证消息是否已添加到数据库
      const messageInDb = await MessageModel.findById(result.id);

      expect(messageInDb).toEqual(
        expect.objectContaining({
          content: messageData.content,
          role: messageData.role,
          sessionId: messageData.sessionId,
          topicId: messageData.topicId,
        }),
      );
    });

    it('should create with tts', async () => {
      const result = await MessageModel.create({
        content: 'abc',
        extra: { translate: { content: 'avc', from: 'a', to: 'f' } },
        role: 'assistant',
        sessionId: 'a',
      });

      // 验证消息是否已添加到数据库
      const messageInDb = await MessageModel.findById(result.id);

      expect(messageInDb).toEqual(
        expect.objectContaining({
          content: 'abc',
          role: 'assistant',
          sessionId: 'a',
          translate: { content: 'avc', from: 'a', to: 'f' },
        }),
      );
    });
  });

  describe('batchCreate', () => {
    it('should batch create message records', async () => {
      const messagesToCreate = [messageData, messageData] as ChatMessage[];
      const results = await MessageModel.batchCreate(messagesToCreate);

      expect(results.success).toBeTruthy();
      expect(results.errors).toBeUndefined();

      // 验证消息是否已添加到数据库
      for (const message of results.ids!) {
        const messageInDb = await MessageModel.findById(message);
        expect(messageInDb).toEqual(
          expect.objectContaining({
            content: messageData.content,
            role: messageData.role,
            sessionId: messageData.sessionId,
            topicId: messageData.topicId,
          }),
        );
      }
    });
  });

  describe('query', () => {
    it('should query messages with pagination', async () => {
      // 创建多条消息以测试查询方法
      await MessageModel.batchCreate([messageData, messageData] as ChatMessage[]);

      const queriedMessages = await MessageModel.query({
        current: 0,
        pageSize: 1,
        sessionId: messageData.sessionId,
        topicId: messageData.topicId,
      });

      expect(queriedMessages).toHaveLength(1);
    });

    it('should query correctly without topic id', async () => {
      // 创建多条消息以测试查询方法
      await MessageModel.batchCreate([messageData, messageData] as ChatMessage[]);

      const queriedMessages = await MessageModel.query({ sessionId: messageData.sessionId });

      expect(queriedMessages).toHaveLength(0);
    });

    it('should query correctly with exactly topic id', async () => {
      // 创建多条消息以测试查询方法
      await MessageModel.batchCreate([
        messageData,
        { ...messageData, topicId: undefined },
      ] as ChatMessage[]);

      const queriedMessages = await MessageModel.query({ sessionId: messageData.sessionId });

      expect(queriedMessages).toHaveLength(1);
    });

    it('should should have correct order', async () => {
      const data: ChatMessage[] = [
        {
          content: '1',
          createdAt: 1_697_120_044_345,
          extra: {},
          id: 'NQ7RscYx',
          meta: {},
          role: 'user',
          sessionId: '1',
          updatedAt: 1_697_120_181_827,
        },
        {
          content: '2',
          createdAt: 1_697_120_130_973,
          extra: {
            fromModel: 'gpt-3.5-turbo-16k',
          },
          id: '9tDAumEx',
          meta: {},
          parentId: 'NQ7RscYx',
          role: 'assistant',
          sessionId: '1',
          updatedAt: 1_697_120_181_827,
        },
        {
          content: '3',
          createdAt: 1_697_120_163_272,
          extra: {
            fromModel: 'gpt-3.5-turbo-16k',
          },
          id: '5Ie5hClg',
          meta: {},
          parentId: 'tOMH7c5R',
          role: 'assistant',
          sessionId: '1',
          updatedAt: 1_697_120_181_827,
        },
        {
          content: '4',
          createdAt: 1_697_120_163_272,
          extra: {},
          id: 'tOMH7c5R',
          meta: {},
          role: 'user',
          sessionId: '1',
          updatedAt: 1_697_120_181_827,
        },
      ];

      await MessageModel.batchCreate(data);

      const queriedMessages = await MessageModel.query({ sessionId: '1' });

      expect(queriedMessages).toEqual([
        {
          content: '1',
          createdAt: 1_697_120_044_345,
          extra: {},
          id: 'NQ7RscYx',
          meta: {},
          role: 'user',
          sessionId: '1',
          updatedAt: 1_697_120_181_827,
        },
        {
          content: '2',
          createdAt: 1_697_120_130_973,
          extra: {
            fromModel: 'gpt-3.5-turbo-16k',
          },
          id: '9tDAumEx',
          meta: {},
          parentId: 'NQ7RscYx',
          role: 'assistant',
          sessionId: '1',
          updatedAt: 1_697_120_181_827,
        },
        {
          content: '4',
          createdAt: 1_697_120_163_272,
          extra: {},
          id: 'tOMH7c5R',
          meta: {},
          role: 'user',
          sessionId: '1',
          updatedAt: 1_697_120_181_827,
        },
        {
          content: '3',
          createdAt: 1_697_120_163_272,
          extra: {
            fromModel: 'gpt-3.5-turbo-16k',
          },
          id: '5Ie5hClg',
          meta: {},
          parentId: 'tOMH7c5R',
          role: 'assistant',
          sessionId: '1',
          updatedAt: 1_697_120_181_827,
        },
      ]);
    });
  });

  describe('findById', () => {
    it('should find a message by id', async () => {
      const createdMessage = await MessageModel.create(messageData);
      const messageInDb = await MessageModel.findById(createdMessage.id);

      expect(messageInDb).toEqual(
        expect.objectContaining({
          content: messageData.content,
          id: createdMessage.id,
        }),
      );
    });
  });

  describe('delete', () => {
    it('should delete a message', async () => {
      const createdMessage = await MessageModel.create(messageData);
      await MessageModel.delete(createdMessage.id);

      const messageInDb = await MessageModel.findById(createdMessage.id);
      expect(messageInDb).toBeUndefined();
    });
  });

  describe('bulkDelete', () => {
    it('should delete many messages', async () => {
      const createdMessage = await MessageModel.create(messageData);
      const createdMessage2 = await MessageModel.create(messageData);
      await MessageModel.bulkDelete([createdMessage.id, createdMessage2.id]);

      const messageInDb1 = await MessageModel.findById(createdMessage.id);
      const messageInDb2 = await MessageModel.findById(createdMessage2.id);
      expect(messageInDb1).toBeUndefined();
      expect(messageInDb2).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a message', async () => {
      const createdMessage = await MessageModel.create(messageData);
      const updateData = { content: 'Updated content' };

      await MessageModel.update(createdMessage.id, updateData);
      const updatedMessage = await MessageModel.findById(createdMessage.id);

      expect(updatedMessage).toHaveProperty('content', 'Updated content');
    });

    it('should update a role and plugins', async () => {
      const createdMessage = await MessageModel.create(messageData);
      const updateData = {
        plugin: { apiName: 'a', arguments: 'abc', identifier: 'b' },
        role: 'tool' as const,
      };

      await MessageModel.update(createdMessage.id, updateData);
      const updatedMessage = await MessageModel.findById(createdMessage.id);

      expect(updatedMessage).toHaveProperty('role', 'tool');
    });
  });

  describe('batchUpdate', () => {
    it('should batch update messages', async () => {
      const createdMessage1 = await MessageModel.create(messageData);
      const createdMessage2 = await MessageModel.create(messageData);
      const updateData = { content: 'Batch updated content' };

      const numUpdated = await MessageModel.batchUpdate(
        [createdMessage1.id, createdMessage2.id],
        updateData,
      );

      expect(numUpdated).toBe(2);

      const updatedMessage1 = await MessageModel.findById(createdMessage1.id);
      const updatedMessage2 = await MessageModel.findById(createdMessage2.id);

      expect(updatedMessage1).toHaveProperty('content', 'Batch updated content');
      expect(updatedMessage2).toHaveProperty('content', 'Batch updated content');
    });
  });

  describe('batchDelete', () => {
    it('should batch delete messages by session id', async () => {
      // 创建多条消息以测试批量删除方法
      await MessageModel.create(messageData);
      await MessageModel.create(messageData);

      await MessageModel.batchDelete(messageData.sessionId, undefined);

      // 验证所有具有给定会话 ID 的消息是否已删除
      const messagesInDb = await MessageModel.query({ sessionId: messageData.sessionId });
      expect(messagesInDb).toHaveLength(0);
    });

    it('should batch delete messages by session id and topic id', async () => {
      // 创建多条消息以测试批量删除方法
      await MessageModel.create(messageData);
      await MessageModel.create(messageData);

      await MessageModel.batchDelete(messageData.sessionId, messageData.topicId);

      // 验证所有具有给定会话 ID 和话题 ID 的消息是否已删除
      const messagesInDb = await MessageModel.query({
        sessionId: messageData.sessionId,
        topicId: messageData.topicId,
      });
      expect(messagesInDb).toHaveLength(0);
    });
  });

  describe('duplicateMessages', () => {
    it('should duplicate messages and update parentId for copied messages', async () => {
      // 创建原始消息和父消息
      const parentMessageData: CreateMessageParams = {
        content: 'Parent message content',
        role: 'user',
        sessionId: 'session1',
        topicId: undefined,
      };
      const parentMessage = await MessageModel.create(parentMessageData);

      const childMessageData: CreateMessageParams = {
        content: 'Child message content',
        parentId: parentMessage.id,
        role: 'user',
        sessionId: 'session1',
      };

      await MessageModel.create(childMessageData);

      // 获取数据库中的消息以进行复制
      const originalMessages = await MessageModel.queryAll();

      // 执行复制操作
      const duplicatedMessages = await MessageModel.duplicateMessages(originalMessages);

      // 验证复制的消息数量是否正确
      expect(duplicatedMessages.length).toBe(originalMessages.length);

      // 验证每个复制的消息是否具有新的唯一ID，并且parentId被正确更新
      for (const original of originalMessages) {
        const copied = duplicatedMessages.find((m) => m.content === original.content);
        expect(copied).toBeDefined();
        expect(copied).not.toBeNull();
        expect(copied!.id).not.toBe(original.id);
        if (original.parentId) {
          const originalParent = originalMessages.find((m) => m.id === original.parentId);
          expect(originalParent).toBeDefined();
          const copiedParent = duplicatedMessages.find(
            (m) => m.content === originalParent!.content,
          );

          expect(copied!.parentId).toBe(copiedParent!.id);
        }
      }
    });
  });

  describe('clearTable', () => {
    it('should clear the table', async () => {
      await MessageModel.create(messageData);
      await MessageModel.clearTable();
      const messages = await MessageModel.queryAll();
      expect(messages).toHaveLength(0);
    });
  });

  describe('updatePluginState', () => {
    it('should update plugin state', async () => {
      const createdMessage = await MessageModel.create(messageData);
      await MessageModel.updatePluginState(createdMessage.id, { testKey: 'testValue' });
      const updatedMessage = await MessageModel.findById(createdMessage.id);
      expect(updatedMessage.pluginState).toHaveProperty('testKey', 'testValue');
    });
  });

  describe('updatePlugin', () => {
    it('should update plugin', async () => {
      const value = {
        apiName: 'abc',
        arguments: 'abc',
        identifier: 'testValue',
      };
      const createdMessage = await MessageModel.create(messageData);
      await MessageModel.updatePlugin(createdMessage.id, value);
      const updatedMessage = await MessageModel.findById(createdMessage.id);
      expect(updatedMessage.plugin).toEqual(value);
    });
  });

  describe('isEmpty', () => {
    it('should return true if table is empty', async () => {
      const number = await MessageModel.count();
      expect(number === 0).toBeTruthy();
    });
  });
});
