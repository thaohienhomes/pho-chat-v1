import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';

import { useChatStore } from '@/store/chat';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shareSlice actions', () => {
  describe('genShareUrl', () => {
    it('TODO', async () => {
      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        await result.current.genShareUrl();
      });
    });
  });
});
