import { Button } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ChevronRight, ShoppingCart, Sparkles } from 'lucide-react';
import { memo, useCallback } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { ChatMessage } from '@/types/message';

import { ErrorActionContainer } from './style';

/**
 * BillingLimit — rendered for `InsufficientQuota` errors that carry a Pho-specific
 * `reasonCode` from the chat route's daily USD cap (PHO-238 / PR #46) or
 * tier-block (PHO-241 / PR #47) paths.
 *
 * Direction (Hien, 2026-05-03): notification, not transaction. Do NOT show
 * `$used / $cap` numbers — feels punitive. Instead: friendly title, soft message,
 * concrete model alternatives the user can switch to with one click, plus a
 * "Mua thêm hạn mức" CTA pointing at the subscription page (placeholder until
 * the Polar/Sepay extra-credits checkout ships in a future ticket).
 *
 * Replaces the previous `<ErrorJsonViewer>` JSON-dump fallback that triggered
 * nga.ntv's `$exception (null type)` PostHog event when she hit the T3 cap.
 */
interface BillingLimitProps {
  data: ChatMessage;
}

interface BillingLimitBody {
  error?: { message?: string } | string;
  reasonCode?: 'DAILY_CAP_EXCEEDED' | 'TIER_BLOCKED';
  retryAfter?: number;
  /** Tier of the blocked request — drives the per-tier alternatives list. */
  tier?: number;
  upgradeUrl?: string;
}

interface ModelAlternative {
  label: string;
  model: string;
  provider: string;
  reason: string;
}

/**
 * Suggest 2–3 in-tier-or-below alternatives the user can keep working on.
 *
 * NOTE: keep this list sync'd with `src/config/pricing.ts` `TIER2_MODELS` —
 * we deliberately suggest only Tier 2 fallbacks (premium picks the user can
 * still afford), never propose models the user already exhausted.
 *
 * Open-source candidates (Kimi K2.6, DeepSeek V4) are intentionally OMITTED
 * until PHO-237 Phase 3 ships their integration; this list will grow then.
 */
const getModelAlternatives = (
  reasonCode: 'DAILY_CAP_EXCEEDED' | 'TIER_BLOCKED' | undefined,
  blockedTier: number | undefined,
): ModelAlternative[] => {
  if (reasonCode === 'TIER_BLOCKED' && blockedTier === 3) {
    return [
      {
        label: 'Claude Sonnet 4.6',
        model: 'anthropic/claude-sonnet-4.6',
        provider: 'vercelaigateway',
        reason: 'Chất lượng cao, đủ tốt cho phần lớn nghiên cứu chuyên sâu',
      },
      {
        label: 'Gemini 2.5 Pro',
        model: 'google/gemini-2.5-pro',
        provider: 'vercelaigateway',
        reason: 'Ngữ cảnh 1M tokens, mạnh khi đọc PDF dài',
      },
      {
        label: 'Gemini 2.5 Flash',
        model: 'google/gemini-2.5-flash',
        provider: 'vercelaigateway',
        reason: 'Nhanh, tiết kiệm — hợp với hỏi nhanh',
      },
    ];
  }
  if (reasonCode === 'DAILY_CAP_EXCEEDED') {
    return [
      {
        label: 'Gemini 2.5 Flash',
        model: 'google/gemini-2.5-flash',
        provider: 'vercelaigateway',
        reason: 'Tốc độ cao, hạn mức rộng hơn',
      },
      {
        label: 'Claude Sonnet 4.6',
        model: 'anthropic/claude-sonnet-4.6',
        provider: 'vercelaigateway',
        reason: 'Chất lượng cao, vẫn dùng được hôm nay',
      },
    ];
  }
  return [];
};

// Same-origin guard so a poisoned backend payload can't redirect off-site.
const safeUpgradeUrl = (raw: unknown, source: string): string => {
  const base = typeof raw === 'string' && raw.startsWith('/') ? raw : '/settings/subscription';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}source=${source}`;
};

const useStyles = createStyles(({ css, token }) => ({
  alt: css`
    cursor: pointer;

    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;

    text-align: start;

    background: ${token.colorBgContainer};

    transition: all 0.15s ease;

    &:hover {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  altLabel: css`
    font-weight: 500;
    color: ${token.colorText};
  `,
  altReason: css`
    margin-block-start: 2px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  description: css`
    line-height: 1.5;
    color: ${token.colorTextSecondary};
    text-align: center;
  `,
  sectionLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
  `,
  title: css`
    font-size: 15px;
    font-weight: 600;
    color: ${token.colorText};
    text-align: center;
  `,
}));

const BillingLimit = memo<BillingLimitProps>(({ data }) => {
  const { styles } = useStyles();
  const body = ((data.error?.body as BillingLimitBody | undefined) ?? {}) as BillingLimitBody;
  const reasonCode = body.reasonCode;
  const blockedTier = body.tier;

  const updateAgentConfig = useAgentStore((s) => s.updateAgentConfig);
  const deleteMessage = useChatStore((s) => s.deleteMessage);

  const isTierBlocked = reasonCode === 'TIER_BLOCKED';
  const title = isTierBlocked
    ? '✨ Model này chưa có trong gói của bạn'
    : '🌙 Bạn đã dùng hết hạn mức hôm nay';
  const description = isTierBlocked
    ? 'Hãy thử model thay thế chất lượng tương đương, hoặc nâng cấp gói để mở khoá.'
    : 'Hạn mức sẽ reset lúc 0:00 (giờ Việt Nam). Trong khi chờ, bạn vẫn dùng được các model khác.';

  const alternatives = getModelAlternatives(reasonCode, blockedTier);

  const switchToModel = useCallback(
    (alt: ModelAlternative) => {
      void updateAgentConfig({ model: alt.model, provider: alt.provider });
      deleteMessage(data.id);
    },
    [updateAgentConfig, deleteMessage, data.id],
  );

  const upgradeUrl = safeUpgradeUrl(body.upgradeUrl, 'billing-limit-upgrade');
  const buyExtraUrl = safeUpgradeUrl(body.upgradeUrl, 'billing-limit-buy-extra');

  return (
    <ErrorActionContainer>
      <Center gap={8}>
        <div className={styles.title}>{title}</div>
        <div className={styles.description}>{description}</div>
      </Center>

      {alternatives.length > 0 && (
        <Flexbox gap={8} width={'100%'}>
          <div className={styles.sectionLabel}>💡 Gợi ý model thay thế</div>
          <Flexbox gap={6} width={'100%'}>
            {alternatives.map((alt) => (
              <button
                className={styles.alt}
                key={alt.model}
                onClick={() => switchToModel(alt)}
                type={'button'}
              >
                <Flexbox align={'center'} horizontal justify={'space-between'}>
                  <Flexbox>
                    <div className={styles.altLabel}>{alt.label}</div>
                    <div className={styles.altReason}>{alt.reason}</div>
                  </Flexbox>
                  <ChevronRight opacity={0.4} size={16} />
                </Flexbox>
              </button>
            ))}
          </Flexbox>
        </Flexbox>
      )}

      <Flexbox gap={8} width={'100%'}>
        <Button block href={buyExtraUrl} icon={ShoppingCart} type={'primary'}>
          Mua thêm hạn mức
        </Button>
        <Button block href={upgradeUrl} icon={Sparkles}>
          Nâng cấp gói
        </Button>
        <Button block onClick={() => deleteMessage(data.id)} variant={'text'}>
          Đóng
        </Button>
      </Flexbox>
    </ErrorActionContainer>
  );
});

export default BillingLimit;
