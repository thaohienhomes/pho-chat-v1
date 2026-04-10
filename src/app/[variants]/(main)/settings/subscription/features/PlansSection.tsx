'use client';

import { useUser } from '@clerk/nextjs';
import { Typography } from 'antd';
import { useTheme } from 'antd-style';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { getPlanByCode } from '@/config/pricing';
import GeoAwarePricingSection from '@/features/PricingCards/GeoAwarePricingSection';
import { useTikTokTracking } from '@/hooks/useTikTokTracking';
import { trackServerInitiateCheckout, trackServerViewContent } from '@/utils/tiktok-server-events';

const { Text } = Typography;

interface PlansSectionProps {
  mobile?: boolean;
}

const PlansSection = memo<PlansSectionProps>(({ mobile }) => {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useUser();
  const { trackUpgradeClick } = useTikTokTracking();
  const currentPlanId = (user?.publicMetadata?.planId as string) || undefined;

  const handleUpgrade = async (planId: string) => {
    // Find the plan details for tracking
    const plan = getPlanByCode(planId);

    // Track ViewContent and InitiateCheckout events for plan selection
    // Using server-side tracking for better reliability (bypasses ad blockers)
    if (plan) {
      console.log('🎯 Tracking plan selection:', { planId, planName: plan.displayName });

      // Track both ViewContent and InitiateCheckout events
      await Promise.all([
        trackServerViewContent(planId, plan.displayName, plan.price),
        trackServerInitiateCheckout(planId, plan.displayName, plan.price),
      ]).catch((error) => {
        console.error('Failed to track TikTok events:', error);
      });

      // Also track with client-side hook for redundancy
      trackUpgradeClick(plan.displayName, 'Plans Section');
    }

    // Navigate to checkout page for better UX
    router.push(`/subscription/checkout?plan=${planId}`);
  };

  return (
    <Flexbox gap={24} width="100%">
      {/* Geo-Aware Pricing Section - Handles Title and Toggle internally */}
      <GeoAwarePricingSection
        currentPlanId={currentPlanId}
        mobile={mobile}
        onSelectPlan={handleUpgrade}
      />

      {/* Additional Info */}
      <Flexbox gap={8} style={{ marginTop: 16 }}>
        <Text style={{ color: theme.colorTextDescription, fontSize: 12 }}>
          💡 <strong>Mix & match models:</strong> Use budget models for simple tasks, premium models
          for complex work.
        </Text>
        <Text style={{ color: theme.colorTextDescription, fontSize: 12 }}>
          🔄 <strong>Flexible usage:</strong> Switch between models anytime based on your needs.
        </Text>
        <Text style={{ color: theme.colorTextDescription, fontSize: 12 }}>
          💰 <strong>73% cheaper</strong> than ChatGPT Plus and Claude Pro.
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

PlansSection.displayName = 'PlansSection';

export default PlansSection;
