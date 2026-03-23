import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

export const useCheckPluginsIsInstalled = (plugins: string[]) => {
  const isDBInited = useGlobalStore(systemStatusSelectors.isDBInited);
  const isLogin = useUserStore(authSelectors.isLogin);
  const checkPluginsIsInstalled = useToolStore((s) => s.useCheckPluginsIsInstalled);

  checkPluginsIsInstalled(!!isDBInited && !!isLogin, plugins);
};
