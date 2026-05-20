// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicModel } from '@/database/models/topic';

import { topicRouter } from './topic';

vi.mock('@/database/server', () => {
  const mockServerDB = {} as any;

  return {
    getServerDB: vi.fn().mockResolvedValue(mockServerDB),
    serverDB: mockServerDB,
  };
});

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(),
}));

vi.mock('@/const/auth', () => ({
  enableClerk: true,
}));

describe('topicRouter.getTopics (PHO-260)', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws UNAUTHORIZED when ctx.userId is missing', async () => {
    // See sessionRouter.getGroupedSessions test for the full story — same
    // anti-pattern (`if (!ctx.userId) return []`) was nuking the topic list.
    const caller = topicRouter.createCaller({ userId: undefined } as any);

    await expect(caller.getTopics({})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('returns topics when authenticated', async () => {
    const mockTopics = [{ id: 't1', title: 'Topic 1' }];
    const mockQuery = vi.fn().mockResolvedValue(mockTopics);

    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          query: mockQuery,
        }) as any,
    );

    const caller = topicRouter.createCaller({ userId } as any);
    const input = { sessionId: 's1' };
    const result = await caller.getTopics(input);

    expect(result).toEqual(mockTopics);
    expect(mockQuery).toHaveBeenCalledWith(input);
  });
});
