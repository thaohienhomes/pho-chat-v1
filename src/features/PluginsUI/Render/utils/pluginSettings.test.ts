import { PluginChannel } from '@lobehub/chat-plugin-sdk/client';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOnPluginSettingsUpdate } from './pluginSettings';

describe('useOnPluginSettingsUpdate', () => {
  const mockCallback = vi.fn();

  // The hook removes its own `message` listener on unmount, so the afterEach
  // only needs to reset the spy.
  afterEach(() => {
    mockCallback.mockReset();
  });

  it('calls the callback when a PluginChannel updatePluginSettings message is received', () => {
    renderHook(() => useOnPluginSettingsUpdate(mockCallback));

    const testSettings = { notifications: true, theme: 'dark' };
    const event = new MessageEvent('message', {
      data: { type: PluginChannel.updatePluginSettings, value: testSettings },
    });

    window.dispatchEvent(event);

    expect(mockCallback).toHaveBeenCalledWith(testSettings);
  });

  it('does not call the callback for non-updatePluginSettings messages', () => {
    renderHook(() => useOnPluginSettingsUpdate(mockCallback));

    const event = new MessageEvent('message', {
      data: { type: 'nonPluginSettingsUpdate', value: { irrelevant: true } },
    });

    window.dispatchEvent(event);

    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('cleans up message event listener on unmount', () => {
    const { unmount } = renderHook(() => useOnPluginSettingsUpdate(mockCallback));

    unmount();

    const event = new MessageEvent('message', {
      data: { type: PluginChannel.updatePluginSettings, value: {} },
    });

    window.dispatchEvent(event);

    expect(mockCallback).not.toHaveBeenCalled();
  });
});
