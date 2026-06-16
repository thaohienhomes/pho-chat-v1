import { PluginChannel } from '@lobehub/chat-plugin-sdk/client';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOnPluginStateUpdate } from './pluginState';

describe('useOnPluginStateUpdate', () => {
  // Mock for the callback function to be used in tests
  const mockCallback = vi.fn();

  // The hook removes its own `message` listener on unmount, so the afterEach
  // only needs to reset the spy.
  afterEach(() => {
    mockCallback.mockReset();
  });

  it('calls the callback when a PluginChannel update message is received', () => {
    renderHook(() => useOnPluginStateUpdate(mockCallback));

    const testKey = 'testKey';
    const testValue = 'testValue';
    const event = new MessageEvent('message', {
      data: { key: testKey, type: PluginChannel.updatePluginState, value: testValue },
    });

    window.dispatchEvent(event);

    expect(mockCallback).toHaveBeenCalledWith(testKey, testValue);
  });

  it('does not call the callback for non-PluginChannel messages', () => {
    renderHook(() => useOnPluginStateUpdate(mockCallback));

    const event = new MessageEvent('message', {
      data: { key: 'key', type: 'nonPluginMessage', value: 'value' },
    });

    window.dispatchEvent(event);

    expect(mockCallback).not.toHaveBeenCalled();
  });
});
