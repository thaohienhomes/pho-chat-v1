// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionModel } from '@/database/models/session';
import { SessionGroupModel } from '@/database/models/sessionGroup';

import { sessionRouter } from './session';

vi.mock('@/database/server', () => {
  const mockServerDB = {} as any;

  return {
    getServerDB: vi.fn().mockResolvedValue(mockServerDB),
    serverDB: mockServerDB,
  };
});

vi.mock('@/database/models/session', () => ({
  SessionModel: vi.fn(),
}));

vi.mock('@/database/models/sessionGroup', () => ({
  SessionGroupModel: vi.fn(),
}));

vi.mock('@/const/auth', () => ({
  enableClerk: true,
}));

describe('sessionRouter.getGroupedSessions (PHO-260)', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws UNAUTHORIZED when ctx.userId is missing', async () => {
    // Before PHO-260 this returned an empty list and the client could not
    // distinguish "stale Clerk session" from "user genuinely has no history".
    // The procedure must now surface UNAUTHORIZED so retryOnUnauthorizedLink
    // gets a chance to refresh the Clerk token.
    const caller = sessionRouter.createCaller({ userId: undefined } as any);

    await expect(caller.getGroupedSessions()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('returns grouped sessions when authenticated', async () => {
    const mockResult = {
      sessionGroups: [{ id: 'g1', name: 'Group 1' }],
      sessions: [{ id: 's1' }],
    };
    const mockQueryWithGroups = vi.fn().mockResolvedValue(mockResult);

    vi.mocked(SessionModel).mockImplementation(
      () =>
        ({
          queryWithGroups: mockQueryWithGroups,
        }) as any,
    );
    vi.mocked(SessionGroupModel).mockImplementation(() => ({}) as any);

    const caller = sessionRouter.createCaller({ userId } as any);
    const result = await caller.getGroupedSessions();

    expect(result).toEqual(mockResult);
    expect(mockQueryWithGroups).toHaveBeenCalled();
  });
});
