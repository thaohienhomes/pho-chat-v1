import { expect } from 'vitest';

import { ChatTopic } from '@/types/topic';

import { ChatTopicDispatch, topicReducer } from './reducer';

describe('topicReducer', () => {
  let state: ChatTopic[];

  beforeEach(() => {
    state = [];
  });

  describe('addTopic', () => {
    it('should add a new ChatTopic object to state', () => {
      const payload: ChatTopicDispatch = {
        type: 'addTopic',
        value: {
          sessionId: '',
          title: 'Test Topic',
        },
      };

      const newState = topicReducer(state, payload);

      expect(newState[0].id).toBeDefined();
    });
  });

  describe('updateTopic', () => {
    it('should update the ChatTopic object in state', () => {
      const topic: ChatTopic = {
        createdAt: Date.now(),
        id: '1',
        title: 'Test Topic',
        updatedAt: Date.now(),
      };

      state.push(topic);

      const payload: ChatTopicDispatch = {
        id: '1',
        type: 'updateTopic',
        value: { title: 'Updated Topic' },
      };

      const newState = topicReducer(state, payload);

      expect(newState[0].title).toBe('Updated Topic');
    });

    it('should update the ChatTopic object with correct properties', () => {
      const topic: ChatTopic = {
        createdAt: Date.now() - 1,
        id: '1',
        title: 'Test Topic',
        updatedAt: Date.now() - 1, // 设定比当前时间前面一点
      };

      state.push(topic);

      const payload: ChatTopicDispatch = {
        id: '1',
        type: 'updateTopic',
        value: { title: 'Updated Topic' },
      };

      const newState = topicReducer(state, payload);

      expect((newState[0].updatedAt as unknown as Date).valueOf()).toBeGreaterThan(topic.updatedAt);
    });
  });

  describe('deleteTopic', () => {
    it('should delete the specified ChatTopic object from state', () => {
      const topic: ChatTopic = {
        createdAt: Date.now(),
        id: '1',
        title: 'Test Topic',
        updatedAt: Date.now(),
      };

      state.push(topic);

      const payload: ChatTopicDispatch = {
        id: '1',
        type: 'deleteTopic',
      };

      const newState = topicReducer(state, payload);

      expect(newState).toEqual([]);
    });
  });

  describe('default', () => {
    it('should return the original state object', () => {
      const payload = {
        type: 'unknown',
      } as unknown as ChatTopicDispatch;

      const newState = topicReducer(state, payload);

      expect(newState).toBe(state);
    });
  });

  describe('produce', () => {
    it('should generate immutable state object', () => {
      const payload: ChatTopicDispatch = {
        type: 'addTopic',
        value: {
          sessionId: '1',
          title: 'Test Topic',
        },
      };

      const newState = topicReducer(state, payload);

      expect(newState).not.toBe(state);
    });

    it('should not modify the original state object', () => {
      const payload: ChatTopicDispatch = {
        type: 'addTopic',
        value: {
          sessionId: '123',

          title: 'Test Topic',
        },
      };

      topicReducer(state, payload);

      expect(state).toEqual([]);
    });
  });
});
