'use client';

import { useTheme } from 'antd-style';
import dynamic from 'next/dynamic';
import { PropsWithChildren, memo, useEffect, useState } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { Flexbox } from 'react-layout-kit';

import { isDesktop } from '@/const/version';
// Import constants from dedicated const files to avoid pulling in full component modules
import { BANNER_HEIGHT } from '@/features/AlertBanner/const';
import { TITLE_BAR_HEIGHT } from '@/features/ElectronTitlebar/const';
import { usePlatform } from '@/hooks/usePlatform';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { HotkeyScopeEnum } from '@/types/hotkey';

import DesktopLayoutContainer from './DesktopLayoutContainer';

// Lazy-load components not needed for initial LCP paint
// Reserve exact banner height while loading to prevent CLS
const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'), {
  loading: () => <div style={{ height: BANNER_HEIGHT }} />,
});
const HotkeyHelperPanel = dynamic(() => import('@/features/HotkeyHelperPanel'), { ssr: false });
const OnboardingModal = dynamic(() => import('@/features/Onboarding/OnboardingModal'), {
  ssr: false,
});
// TitleBar only renders in Electron desktop — lazy-load to avoid bundling electron store
const TitleBar = isDesktop ? dynamic(() => import('@/features/ElectronTitlebar')) : () => null;
// SideBar for non-Electron desktop path — lazy-load its subcomponents
// Reserve exact SideNav width (58px) while loading to prevent CLS
const SideBar = dynamic(() => import('./SideBar'), {
  loading: () => <div style={{ height: '100%', minHeight: 640, width: 58 }} />,
});
// RegisterHotkeys has no visual output — lazy-load to defer hotkey hook imports
// ssr: false required because it uses useSearchParams() via nuqs (usePinnedAgentState)
const RegisterHotkeys = dynamic(() => import('./RegisterHotkeys'), { ssr: false });

const Layout = memo<PropsWithChildren>(({ children }) => {
  const { isPWA } = usePlatform();
  const theme = useTheme();

  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const isLogin = useUserStore(authSelectors.isLogin);
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const isOnboard = useUserStore((s) => s.isOnboard);

  useEffect(() => {
    // Show onboarding only for logged-in users who haven't completed onboarding
    if (isUserStateInit && isLogin && !isOnboard) {
      // Delay to allow UI to settle
      const timer = setTimeout(() => setShowOnboarding(true), 500);
      return () => clearTimeout(timer);
    }
  }, [isLogin, isUserStateInit, isOnboard]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  return (
    <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
      {isDesktop && <TitleBar />}
      {showCloudPromotion && <CloudBanner />}
      <Flexbox
        height={
          isDesktop
            ? `calc(100% - ${TITLE_BAR_HEIGHT}px)`
            : showCloudPromotion
              ? `calc(100% - ${BANNER_HEIGHT}px)`
              : '100%'
        }
        horizontal
        style={{
          borderTop: isPWA ? `1px solid ${theme.colorBorder}` : undefined,
          position: 'relative',
        }}
        width={'100%'}
      >
        {isDesktop ? (
          <DesktopLayoutContainer>{children}</DesktopLayoutContainer>
        ) : (
          <>
            <SideBar />
            {children}
          </>
        )}
      </Flexbox>
      <HotkeyHelperPanel />
      <RegisterHotkeys />

      {/* Onboarding Modal for first-time users */}
      <OnboardingModal onComplete={handleOnboardingComplete} open={showOnboarding} />
    </HotkeysProvider>
  );
});

Layout.displayName = 'DesktopMainLayout';

export default Layout;
