import { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { act, renderHook } from '@testing-library/react';
import useSWR from 'swr';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notification } from '@/components/AntdStaticMethods';
import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import { DiscoverPluginItem } from '@/types/discover';

import { useToolStore } from '../../store';

// Mock necessary modules and functions
vi.mock('@/components/AntdStaticMethods', () => ({
  notification: {
    error: vi.fn(),
  },
}));
// Mock the pluginService.getToolList method
vi.mock('@/services/plugin', () => ({
  pluginService: {
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
  },
}));

vi.mock('@/services/tool', () => ({
  toolService: {
    getOldPluginList: vi.fn(),
    getToolList: vi.fn(),
    getToolManifest: vi.fn(),
  },
}));

// Mock i18next
vi.mock('i18next', () => ({
  t: vi.fn((key) => key),
}));

// pho.chat prepends bundled builtin plugins (PubMed, ArXiv, etc.) to the store
// list. Stub them out so these tests assert purely on the mocked store data.
vi.mock('@/config/bundledPlugins', () => ({
  BUNDLED_PLUGINS: [],
}));

const pluginManifestMock = {
  $schema: '../node_modules/@lobehub/chat-plugin-sdk/schema.json',
  api: [
    {
      description: '获取当前天气情况',
      name: 'fetchCurrentWeather',
      parameters: {
        properties: {
          city: {
            description: '城市名称',
            type: 'string',
          },
        },
        required: ['city'],
        type: 'object',
      },
      url: 'https://realtime-weather.chat-plugin.lobehub.com/api/v1',
    },
  ],
  author: 'LobeHub',
  createAt: '2023-08-12',
  homepage: 'https://github.com/lobehub/chat-plugin-realtime-weather',
  identifier: 'realtime-weather',
  meta: {
    avatar: '🌈',
    description: 'Get realtime weather information',
    tags: ['weather', 'realtime'],
    title: 'Realtime Weather',
  },
  ui: {
    height: 310,
    url: 'https://realtime-weather.chat-plugin.lobehub.com/iframe',
  },
  version: '1',
};
// Mock useSWR
vi.mock('swr', async () => {
  const actual = await vi.importActual('swr');
  return {
    ...(actual as any),
    default: vi.fn(),
  };
});

const logError = console.error;
beforeEach(() => {
  vi.restoreAllMocks();
  useToolStore.setState({
    oldPluginItems: [
      {
        avatar: '🍏',
        identifier: 'plugin1',
        manifest: 'https://abc.com/manifest.json',
        title: 'plugin1',
      } as DiscoverPluginItem,
    ],
  });
  console.error = () => {};
});
afterEach(() => {
  console.error = logError;
});

describe('useToolStore:pluginStore', () => {
  describe('loadPluginStore', () => {
    it('should load plugin list and update state', async () => {
      // Given
      const pluginListMock = [{ identifier: 'plugin1' }, { identifier: 'plugin2' }];
      (toolService.getOldPluginList as Mock).mockResolvedValue({ items: pluginListMock });

      // When
      let pluginList;
      await act(async () => {
        pluginList = await useToolStore.getState().loadPluginStore();
      });

      // Then
      expect(toolService.getOldPluginList).toHaveBeenCalled();
      expect(pluginList).toEqual(pluginListMock);
      expect(useToolStore.getState().oldPluginItems).toEqual(pluginListMock);
    });

    it('should handle errors when loading plugin list', async () => {
      // Given
      const error = new Error('Failed to load plugin list');
      (toolService.getOldPluginList as Mock).mockRejectedValue(error);

      // When
      let pluginList;
      let errorOccurred = false;
      try {
        await act(async () => {
          pluginList = await useToolStore.getState().loadPluginStore();
        });
      } catch {
        errorOccurred = true;
      }

      // Then
      expect(toolService.getOldPluginList).toHaveBeenCalled();
      expect(errorOccurred).toBe(true);
      expect(pluginList).toBeUndefined();
      // Ensure the state is not updated with an undefined value
      expect(useToolStore.getState().oldPluginItems).not.toBeUndefined();
    });
  });

  describe('useFetchPluginStore', () => {
    it('should use SWR to fetch plugin store', async () => {
      // Given
      const pluginListMock = [{ identifier: 'plugin1' }, { identifier: 'plugin2' }];
      (useSWR as Mock).mockReturnValue({
        data: pluginListMock,
        error: null,
        isValidating: false,
      });

      // When
      const { result } = renderHook(() => useToolStore.getState().useFetchPluginStore());

      // Then
      expect(useSWR).toHaveBeenCalledWith('loadPluginStore', expect.any(Function), {
        fallbackData: [],
        revalidateOnFocus: false,
        suspense: true,
      });
      expect(result.current.data).toEqual(pluginListMock);
      expect(result.current.error).toBeNull();
      expect(result.current.isValidating).toBe(false);
    });

    it('should handle errors when fetching plugin store with SWR', async () => {
      // Given
      const error = new Error('Failed to fetch plugin store');
      (useSWR as Mock).mockReturnValue({
        data: null,
        error: error,
        isValidating: false,
      });

      // When
      const { result } = renderHook(() => useToolStore.getState().useFetchPluginStore());

      // Then
      expect(useSWR).toHaveBeenCalledWith('loadPluginStore', expect.any(Function), {
        fallbackData: [],
        revalidateOnFocus: false,
        suspense: true,
      });
      expect(result.current.data).toBeNull();
      expect(result.current.error).toEqual(error);
      expect(result.current.isValidating).toBe(false);
    });
  });

  describe('installPlugin', () => {
    it('should install a plugin with valid manifest', async () => {
      const pluginIdentifier = 'plugin1';

      const originalUpdateInstallLoadingState = useToolStore.getState().updateInstallLoadingState;
      const updateInstallLoadingStateMock = vi.fn();

      act(() => {
        useToolStore.setState({
          updateInstallLoadingState: updateInstallLoadingStateMock,
        });
      });

      const pluginManifestMock = {
        $schema: '../node_modules/@lobehub/chat-plugin-sdk/schema.json',
        api: [
          {
            description: '获取当前天气情况',
            name: 'fetchCurrentWeather',
            parameters: {
              properties: {
                city: {
                  description: '城市名称',
                  type: 'string',
                },
              },
              required: ['city'],
              type: 'object',
            },
            url: 'https://realtime-weather.chat-plugin.lobehub.com/api/v1',
          },
        ],
        author: 'LobeHub',
        createAt: '2023-08-12',
        homepage: 'https://github.com/lobehub/chat-plugin-realtime-weather',
        identifier: 'realtime-weather',
        meta: {
          avatar: '🌈',
          description: 'Get realtime weather information',
          tags: ['weather', 'realtime'],
          title: 'Realtime Weather',
        },
        ui: {
          height: 310,
          url: 'https://realtime-weather.chat-plugin.lobehub.com/iframe',
        },
        version: '1',
      };
      (toolService.getToolManifest as Mock).mockResolvedValue(pluginManifestMock);

      await act(async () => {
        await useToolStore.getState().installPlugin(pluginIdentifier);
      });

      // Then
      expect(toolService.getToolManifest).toHaveBeenCalled();
      expect(notification.error).not.toHaveBeenCalled();
      expect(updateInstallLoadingStateMock).toHaveBeenCalledTimes(2);
      expect(pluginService.installPlugin).toHaveBeenCalledWith({
        identifier: 'plugin1',
        manifest: pluginManifestMock,
        type: 'plugin',
      });

      act(() => {
        useToolStore.setState({
          updateInstallLoadingState: originalUpdateInstallLoadingState,
        });
      });
    });

    it('should throw error with no error', async () => {
      // Given

      const error = new TypeError('noManifest');

      // Mock necessary modules and functions
      (toolService.getToolManifest as Mock).mockRejectedValue(error);

      useToolStore.setState({
        oldPluginItems: [
          {
            avatar: '🍏',
            identifier: 'plugin1',
            title: 'plugin1',
          } as DiscoverPluginItem,
        ],
      });

      await act(async () => {
        await useToolStore.getState().installPlugin('plugin1');
      });

      expect(notification.error).toHaveBeenCalledWith({
        description: 'error.noManifest',
        message: 'error.installError',
      });
    });
  });

  describe('installPlugins', () => {
    it('should install multiple plugins', async () => {
      // Given
      act(() => {
        useToolStore.setState({
          oldPluginItems: [
            {
              avatar: '🍏',
              identifier: 'plugin1',
              manifest: 'https://abc.com/manifest.json',
              title: 'plugin1',
            } as DiscoverPluginItem,
            {
              avatar: '🍏',
              identifier: 'plugin2',
              manifest: 'https://abc.com/manifest.json',
              title: 'plugin2',
            } as DiscoverPluginItem,
          ],
        });
      });

      const plugins = ['plugin1', 'plugin2'];

      (toolService.getToolManifest as Mock).mockResolvedValue(pluginManifestMock);

      // When
      await act(async () => {
        await useToolStore.getState().installPlugins(plugins);
      });

      expect(pluginService.installPlugin).toHaveBeenCalledTimes(2);
    });
  });

  describe('unInstallPlugin', () => {
    it('should uninstall a plugin and remove its manifest', async () => {
      // Given
      const pluginIdentifier = 'plugin1';
      act(() => {
        useToolStore.setState({
          installedPlugins: [
            {
              identifier: pluginIdentifier,
              manifest: {
                identifier: pluginIdentifier,
                meta: {},
              } as LobeChatPluginManifest,
              type: 'plugin',
            },
          ],
        });
      });

      // When
      act(() => {
        useToolStore.getState().uninstallPlugin(pluginIdentifier);
      });

      // Then
      expect(pluginService.uninstallPlugin).toBeCalledWith(pluginIdentifier);
    });
  });

  describe('updateInstallLoadingState', () => {
    it('should update the loading state for a plugin', () => {
      const pluginIdentifier = 'abc';
      const loadingState = true;
      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.updateInstallLoadingState(pluginIdentifier, loadingState);
      });

      expect(result.current.pluginInstallLoading[pluginIdentifier]).toBe(loadingState);
    });

    it('should clear the loading state for a plugin', () => {
      // Given
      const pluginIdentifier = 'dddd';
      const loadingState = undefined;

      act(() => {
        useToolStore.setState({ pluginInstallLoading: { [pluginIdentifier]: true } });
      });
      const { result } = renderHook(() => useToolStore());

      // When
      act(() => {
        result.current.updateInstallLoadingState(pluginIdentifier, loadingState);
      });

      // Then
      expect(result.current.pluginInstallLoading[pluginIdentifier]).toBe(loadingState);
    });
  });
});
