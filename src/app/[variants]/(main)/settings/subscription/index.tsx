'use client';

import { Form } from '@lobehub/ui';
import { Alert } from 'antd';
import { useTheme } from 'antd-style';
import { useSearchParams } from 'next/navigation';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { mutate } from 'swr';

// CompareSection temporarily hidden — plan data needs to be updated to match current pricing
// import CompareSection from './features/CompareSection';
import CreditsSection from './features/CreditsSection';
import PlansSection from './features/PlansSection';

interface SubscriptionPageProps {
  mobile?: boolean;
}

const SubscriptionPage = memo<SubscriptionPageProps>(({ mobile }) => {
  const { t } = useTranslation('setting');
  const theme = useTheme();
  const searchParams = useSearchParams();
  const isPaymentSuccess = searchParams.get('success') === 'true';
  const hasInvalidated = useRef(false);

  // Invalidate SWR caches after successful payment so model access refreshes
  useEffect(() => {
    if (isPaymentSuccess && !hasInvalidated.current) {
      hasInvalidated.current = true;
      void mutate('model-access-allowed');
      void mutate('model-access-usage-stats');
    }
  }, [isPaymentSuccess]);

  return (
    <Form.Group
      style={{ color: theme.colorText, maxWidth: '1024px', width: '100%' }}
      title={t('subscription.title')}
      variant={'borderless'}
    >
      <Flexbox gap={24} paddingBlock={20} width={'100%'}>
        {isPaymentSuccess && (
          <Alert
            closable
            message="Payment successful! Your plan has been upgraded. Model access will refresh shortly."
            showIcon
            type="success"
          />
        )}
        <CreditsSection />
        <PlansSection mobile={mobile} />
        {/* CompareSection hidden until plan data is updated */}
      </Flexbox>
    </Form.Group>
  );
});

SubscriptionPage.displayName = 'SubscriptionPage';

export default SubscriptionPage;
