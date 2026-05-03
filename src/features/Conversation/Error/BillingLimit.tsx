import { Button } from '@lobehub/ui';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useChatStore } from '@/store/chat';
import { ChatMessage } from '@/types/message';

import { ErrorActionContainer, FormAction } from './style';

/**
 * BillingLimit — rendered for `InsufficientQuota` errors that carry a Pho-specific
 * `reasonCode` (`DAILY_CAP_EXCEEDED` / `TIER_BLOCKED`) from the chat route.
 *
 * Backend (chat/[provider]/route.ts) emits HTTP 429 via `createErrorResponse(InsufficientQuota, {
 *   dailyCostCap, dailyCostUsed, error: { message }, reasonCode, retryAfter, upgradeUrl
 * })`. The alert above this component already shows the specific Vietnamese message
 * (surfaced by `getMessageError` in PHO-238). This component adds an actionable
 * footer: cap usage summary + upgrade CTA + dismiss, so the user has a clear next
 * step instead of `<ErrorJsonViewer>`'s raw JSON dump (the previous fallback).
 */
interface BillingLimitProps {
  data: ChatMessage;
}

interface BillingLimitBody {
  dailyCostCap?: number;
  dailyCostUsed?: number;
  error?: { message?: string } | string;
  message?: string;
  reasonCode?: 'DAILY_CAP_EXCEEDED' | 'TIER_BLOCKED';
  retryAfter?: number;
  upgradeUrl?: string;
}

// Only allow same-origin paths so a poisoned backend payload can't redirect off-site.
const safeUpgradeUrl = (raw: unknown): string =>
  typeof raw === 'string' && raw.startsWith('/') ? raw : '/settings/subscription';

const BillingLimit = memo<BillingLimitProps>(({ data }) => {
  const body = ((data.error?.body as BillingLimitBody | undefined) ?? {}) as BillingLimitBody;
  const reasonCode = body.reasonCode;
  const upgradeUrl = safeUpgradeUrl(body.upgradeUrl);
  const isTierBlocked = reasonCode === 'TIER_BLOCKED';

  const deleteMessage = useChatStore((s) => s.deleteMessage);

  const title = isTierBlocked
    ? 'Gói hiện tại không hỗ trợ model này'
    : 'Đã đạt giới hạn chi phí hôm nay';

  // Prefer the backend's specific message (e.g. "Bạn đã dùng hết hạn mức Tier 3
  // hôm nay ($26.50/$26.00)..."); fall back to whatever the alert layer received.
  const description =
    (typeof body.error === 'object' ? body.error?.message : body.error) ||
    body.message ||
    data.error?.message ||
    'Hiện không thể gửi tin nhắn. Vui lòng thử model khác hoặc nâng cấp gói.';

  const showUsageLine =
    typeof body.dailyCostUsed === 'number' && typeof body.dailyCostCap === 'number';

  const AvatarIcon = isTierBlocked ? Sparkles : AlertTriangle;

  return (
    <ErrorActionContainer>
      <FormAction
        avatar={<AvatarIcon size={48} strokeWidth={1.5} />}
        description={description}
        title={title}
      >
        <Flexbox gap={12} width={'100%'}>
          {showUsageLine && (
            <Flexbox style={{ fontSize: 12, opacity: 0.6, textAlign: 'center' }}>
              {`Đã dùng $${body.dailyCostUsed!.toFixed(2)} / $${body.dailyCostCap!.toFixed(2)} hôm nay`}
            </Flexbox>
          )}
          <Button block href={upgradeUrl} type={'primary'}>
            Nâng cấp gói
          </Button>
          <Button block onClick={() => deleteMessage(data.id)}>
            Đóng
          </Button>
        </Flexbox>
      </FormAction>
    </ErrorActionContainer>
  );
});

export default BillingLimit;
