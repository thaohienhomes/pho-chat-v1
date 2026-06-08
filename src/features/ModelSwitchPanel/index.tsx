import { ModelIcon } from '@lobehub/icons';
import { Button, Popover } from 'antd';
import { createStyles, useThemeMode } from 'antd-style';
import { Eye, Plug, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, memo, startTransition, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { notification } from '@/components/AntdStaticMethods';
import { getModelTier } from '@/config/pricing';
import {
  MODEL_DESCRIPTIONS,
  NEW_MODEL_IDS,
  SPEED_MODELS,
  type TierGroup,
  useEnabledChatModels,
} from '@/hooks/useEnabledChatModels';
import { useModelAccess } from '@/hooks/useModelAccess';
import { forceReauth } from '@/libs/trpc/client/authRecovery';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/slices/chat';

/* ──────────── Tier palette ──────────── */
const TIER = {
  0: {
    accent: '#ec4899',
    icon: '✨',
    labelKey: 'ModelSwitchPanel.tierAuto' as const,
    quotaCount: 0,
    quotaKey: '',
  },
  1: {
    accent: '#22c55e',
    icon: '⚡',
    labelKey: 'ModelSwitchPanel.tierFree' as const,
    quotaCount: 0,
    quotaKey: '',
  },
  2: {
    accent: '#a78bfa',
    icon: '🔮',
    labelKey: 'ModelSwitchPanel.tierPro' as const,
    quotaCount: 20,
    quotaKey: 'ModelSwitchPanel.quotaHint' as const,
  },
  3: {
    accent: '#f59e0b',
    icon: '👑',
    labelKey: 'ModelSwitchPanel.tierFlagship' as const,
    quotaCount: 5,
    quotaKey: 'ModelSwitchPanel.quotaHint' as const,
  },
} as const;

/* ──────────── Helpers ──────────── */
const ctxLabel = (n?: number) =>
  !n ? '' : n >= 1e6 ? `${Math.round(n / 1e6)}M` : `${Math.round(n / 1e3)}K`;

const iconBg = (tier: number, isDark: boolean) => {
  if (tier === 0) return isDark ? 'rgba(236,72,153,0.18)' : 'rgba(236,72,153,0.1)';
  if (isDark) {
    return tier === 1
      ? 'rgba(34,197,94,0.15)'
      : tier === 2
        ? 'rgba(139,92,246,0.15)'
        : 'rgba(245,158,11,0.15)';
  }
  return tier === 1
    ? 'rgba(34,197,94,0.1)'
    : tier === 2
      ? 'rgba(139,92,246,0.1)'
      : 'rgba(245,158,11,0.1)';
};

/* ──────────── Styles ──────────── */
const useStyles = createStyles(({ css, token, isDarkMode }) => {
  const isDark = isDarkMode;
  const mutedText = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const subtleText = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.32)';
  const hoverBg = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)';
  const selectedBg = isDark ? 'rgba(139,92,246,0.14)' : 'rgba(139,92,246,0.08)';
  const sectionBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const capBg = isDark ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.1)';
  const capColor = isDark ? 'rgba(167,139,250,0.9)' : 'rgba(109,40,217,0.7)';
  const capBorder = isDark ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.15)';
  const panelBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

  return {
    capIcon: css`
      display: flex;
      align-items: center;
      justify-content: center;

      width: 20px;
      height: 20px;
      border: 1px solid ${capBorder};
      border-radius: 5px;

      color: ${capColor};

      background: ${capBg};
    `,

    ctx: css`
      flex-shrink: 0;

      min-width: 30px;

      font-size: 10px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: ${subtleText};
      text-align: end;
    `,

    dot: css`
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      border-radius: 50%;
    `,

    empty: css`
      padding-block: 28px;
      padding-inline: 16px;

      font-size: 13px;
      color: ${mutedText};
      text-align: center;
    `,

    footer: css`
      display: flex;
      align-items: center;
      justify-content: center;

      padding-block: 10px;
      padding-inline: 16px;
      border-block-start: 1px solid ${sectionBorder};
    `,

    modelIcon: css`
      display: flex;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;

      width: 32px;
      height: 32px;
      border-radius: 8px;

      transition: transform 0.15s;
    `,

    modelName: css`
      display: flex;
      gap: 6px;
      align-items: center;

      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      color: ${token.colorText};
    `,

    modelRow: css`
      cursor: pointer;

      position: relative;

      display: flex;
      gap: 10px;
      align-items: center;

      padding-block: 8px;
      padding-inline: 16px;

      transition: background 0.15s ease;

      &:hover {
        background: ${hoverBg};
      }

      &:active {
        background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'};
      }
    `,

    modelRowDisabled: css`
      cursor: not-allowed;
      opacity: 0.4;
      filter: grayscale(0.8);
    `,

    modelSub: css`
      overflow: hidden;

      margin-block-start: 2px;

      font-size: 11px;
      color: ${mutedText};
      text-overflow: ellipsis;
      white-space: nowrap;
    `,

    newBadge: css`
      display: inline-flex;

      padding-block: 2px;
      padding-inline: 7px;
      border-radius: 4px;

      font-size: 9px;
      font-weight: 700;
      color: ${isDark ? '#f87171' : '#dc2626'};
      letter-spacing: 0.3px;

      background: ${isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)'};

      animation: moi-pulse 2s ease-in-out infinite;

      @keyframes moi-pulse {
        0%,
        100% {
          opacity: 1;
        }

        50% {
          opacity: 0.55;
        }
      }
    `,

    panelContent: css`
      overflow: hidden;
      display: flex;
      flex-direction: column;

      width: 380px;
      max-height: 480px;
      margin-block: -12px;
      margin-inline: -16px;
    `,

    scroll: css`
      overflow: hidden auto;
      flex: 1;

      &::-webkit-scrollbar {
        width: 5px;
      }

      &::-webkit-scrollbar-track {
        background: transparent;
      }

      &::-webkit-scrollbar-thumb {
        border-radius: 4px;
        background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};

        &:hover {
          background: ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)'};
        }
      }
    `,

    search: css`
      position: relative;
      padding-block: 12px;
      padding-inline: 16px;
      border-block-end: 1px solid ${sectionBorder};
    `,

    searchIcon: css`
      pointer-events: none;

      position: absolute;
      inset-block-start: 50%;
      inset-inline-start: 28px;
      transform: translateY(-50%);

      color: ${token.colorTextQuaternary};
    `,

    searchInput: css`
      width: 100%;
      padding-block: 10px;
      padding-inline: 38px 14px;
      border: 1px solid ${panelBorder};
      border-radius: 10px;

      font-family: inherit;
      font-size: 13px;
      color: ${token.colorText};

      background: ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)'};
      outline: none;

      transition:
        border-color 0.2s,
        box-shadow 0.2s;

      &::placeholder {
        color: ${token.colorTextQuaternary};
      }

      &:focus {
        border-color: ${isDark ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.4)'};
        box-shadow: 0 0 0 3px ${isDark ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.08)'};
      }
    `,

    section: css`
      padding-block: 4px;
      padding-inline: 0;

      & + & {
        border-block-start: 1px solid ${sectionBorder};
      }
    `,

    sectionHeader: css`
      display: flex;
      gap: 6px;
      align-items: center;

      padding-block: 10px 6px;
      padding-inline: 16px;

      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    `,

    selected: css`
      background: ${selectedBg};
    `,

    selectedBar: css`
      position: absolute;
      inset-block: 4px 4px;
      inset-inline-start: 0;

      width: 3px;
      border-radius: 0 3px 3px 0;
    `,

    speedBadge: css`
      display: inline-flex;
      gap: 2px;
      align-items: center;

      padding-block: 2px;
      padding-inline: 6px;
      border-radius: 4px;

      font-size: 8px;
      font-weight: 700;
      color: #000;

      background: linear-gradient(135deg, #eab308, #f97316);
    `,

    speedBar: css`
      flex-shrink: 0;
      height: 3px;
      border-radius: 2px;
    `,

    speedLabel: css`
      font-size: 9px;
      color: ${subtleText};
    `,

    tierLegend: css`
      display: flex;
      gap: 10px;
      font-size: 10px;
      color: ${mutedText};

      & > span {
        display: flex;
        gap: 3px;
        align-items: center;
      }
    `,

    trigger: css`
      cursor: pointer;
    `,
  };
});

/* ──────────── Tier badges (theme-aware) ──────────── */
const TierBadge = memo<{ isDark: boolean; tier: number }>(({ tier, isDark }) => {
  if (tier === 1)
    return (
      <span
        style={{
          background: isDark ? 'rgba(34,197,94,0.18)' : 'rgba(22,163,74,0.12)',
          borderRadius: 4,
          color: isDark ? '#4ade80' : '#15803d',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.3,
          padding: '2px 7px',
        }}
      >
        FREE
      </span>
    );
  if (tier === 2)
    return (
      <span
        style={{
          background: isDark ? 'rgba(168,85,247,0.22)' : 'rgba(124,58,237,0.14)',
          borderRadius: 4,
          color: isDark ? '#c084fc' : '#6d28d9',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.3,
          padding: '2px 7px',
        }}
      >
        PRO
      </span>
    );
  return (
    <span
      style={{
        background: isDark
          ? 'linear-gradient(135deg,rgba(245,158,11,0.22),rgba(239,68,68,0.18))'
          : 'linear-gradient(135deg,rgba(217,119,6,0.16),rgba(220,38,38,0.12))',
        borderRadius: 4,
        color: isDark ? '#fbbf24' : '#b45309',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.3,
        padding: '2px 7px',
      }}
    >
      MAX
    </span>
  );
});

/* ──────────── Component ──────────── */
interface IProps {
  children?: ReactNode;
  onOpenChange?: (v: boolean) => void;
  open?: boolean;
  updating?: boolean;
}

const ModelSwitchPanel = memo<IProps>(({ children, onOpenChange, open: extOpen }) => {
  const { styles, cx } = useStyles();
  const { isDarkMode: isDark } = useThemeMode();
  const { t } = useTranslation('components');
  const router = useRouter();
  const model = useAgentStore((s) => agentSelectors.currentAgentModel(s));
  const updateAgentConfig = useAgentStore((s) => s.updateAgentConfig);
  const tiers = useEnabledChatModels() as TierGroup[];
  const { authError, canUseTier: canUse } = useModelAccess();
  const [q, setQ] = useState('');

  /* ── internal open state ── */
  const [intOpen, setIntOpen] = useState(false);
  const isOpen = extOpen ?? intOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      setIntOpen(v);
      onOpenChange?.(v);
      if (!v) setQ('');
    },
    [onOpenChange],
  );

  /* ── search filter ── */
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return tiers;
    return tiers
      .map((t) => ({
        ...t,
        children: t.children.filter(
          (m) =>
            m.id.toLowerCase().includes(s) ||
            m.displayName.toLowerCase().includes(s) ||
            (MODEL_DESCRIPTIONS[m.id] || '').toLowerCase().includes(s),
        ),
      }))
      .filter((t) => t.children.length > 0);
  }, [tiers, q]);

  const onSelect = useCallback(
    async (id: string, prov: string) => {
      setOpen(false);
      startTransition(() => {
        updateAgentConfig({ model: id, provider: prov });
      });
    },
    [updateAgentConfig, setOpen],
  );

  const handleLockedModelClick = useCallback(
    (modelId: string, displayName: string) => {
      // A broken session (server couldn't verify the token) makes the picker
      // think the user is free-tier and greys out PRO/FLAGSHIP. Don't mislead a
      // paying user with an "upgrade" prompt — surface the real cause (expired
      // session) and offer re-login instead. See useModelAccess / models/allowed.
      if (authError) {
        const sessionKey = `session-expired-${Date.now()}`;
        notification.warning({
          btn: (
            <Button
              onClick={() => {
                notification.destroy(sessionKey);
                forceReauth();
              }}
              size="small"
              type="primary"
            >
              {t('ModelSwitchPanel.loginButton')}
            </Button>
          ),
          description: t('ModelSwitchPanel.sessionExpiredDescription'),
          duration: 8,
          key: sessionKey,
          message: t('ModelSwitchPanel.sessionExpiredTitle'),
        });
        return;
      }

      const tier = getModelTier(modelId);
      const tierLabel = tier === 3 ? 'Flagship' : 'Professional';
      const key = `locked-model-${Date.now()}`;
      notification.info({
        btn: (
          <Button
            onClick={() => {
              notification.destroy(key);
              router.push('/settings?active=subscription');
            }}
            size="small"
            type="primary"
          >
            {t('ModelSwitchPanel.upgradeButton')}
          </Button>
        ),
        description: t('ModelSwitchPanel.upgradeDescription', { tierLabel }),
        duration: 6,
        key,
        message: t('ModelSwitchPanel.upgradeTitle', { modelName: displayName }),
      });
    },
    [authError, router, t],
  );

  /* ── quota hint color ── */
  const quotaColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.3)';

  /* ── Panel content (used as Popover content) ── */
  const panelContent = (
    <div className={styles.panelContent}>
      {/* ── Search ── */}
      <div className={styles.search}>
        <Search className={styles.searchIcon} size={15} />
        <input
          autoFocus
          className={styles.searchInput}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ModelSwitchPanel.searchPlaceholder')}
          type="text"
          value={q}
        />
      </div>

      {/* ── Scroll ── */}
      <div className={styles.scroll}>
        {filtered.map((tier) => {
          const tierNum = (tier.tierGroup ?? 1) as 0 | 1 | 2 | 3;
          const cfg = TIER[tierNum];
          return (
            <div className={styles.section} key={tier.id}>
              {tierNum !== 0 && (
                <div className={styles.sectionHeader} style={{ color: cfg.accent }}>
                  <span style={{ fontSize: 13 }}>{cfg.icon}</span>
                  {t(cfg.labelKey)}
                  {cfg.quotaKey && (
                    <span
                      style={{
                        color: quotaColor,
                        fontSize: 9,
                        fontWeight: 400,
                        marginLeft: 'auto',
                        textTransform: 'none',
                      }}
                    >
                      {t(cfg.quotaKey as 'ModelSwitchPanel.quotaHint', { count: cfg.quotaCount })}
                    </span>
                  )}
                </div>
              )}

              {tier.children.map((m) => {
                const ok = canUse(m.id);
                const prov = (m as any).originProvider || tier.id;
                const sel = model === m.id;
                const isNew = NEW_MODEL_IDS.has(m.id);
                const speed = SPEED_MODELS[m.id];
                const desc = MODEL_DESCRIPTIONS[m.id];
                const ctx = ctxLabel(m.contextWindowTokens);
                const mTier = getModelTier(m.id);

                return (
                  <div
                    className={cx(
                      styles.modelRow,
                      sel && styles.selected,
                      !ok && styles.modelRowDisabled,
                    )}
                    key={m.id}
                    onClick={
                      ok
                        ? () => onSelect(m.id, prov)
                        : () => handleLockedModelClick(m.id, m.displayName)
                    }
                  >
                    {sel && (
                      <div className={styles.selectedBar} style={{ background: cfg.accent }} />
                    )}

                    <div
                      className={styles.modelIcon}
                      style={{
                        background: speed
                          ? isDark
                            ? 'linear-gradient(135deg,rgba(250,204,21,0.15),rgba(251,146,60,0.12))'
                            : 'linear-gradient(135deg,rgba(250,204,21,0.12),rgba(251,146,60,0.08))'
                          : iconBg(tierNum, isDark),
                      }}
                    >
                      <ModelIcon model={m.id} size={18} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.modelName}>
                        {m.displayName}
                        {mTier > 1 && <TierBadge isDark={isDark} tier={mTier} />}
                        {speed && <span className={styles.speedBadge}>⚡ {speed} tok/s</span>}
                        {isNew && <span className={styles.newBadge}>MỚI</span>}
                      </div>
                      {speed ? (
                        <div
                          style={{ alignItems: 'center', display: 'flex', gap: 4, marginTop: 3 }}
                        >
                          <div
                            className={styles.speedBar}
                            style={{
                              background: 'linear-gradient(90deg,#eab308,#f97316)',
                              width: 36,
                            }}
                          />
                          <span className={styles.speedLabel}>{desc || 'Instant generation'}</span>
                        </div>
                      ) : desc ? (
                        <div className={styles.modelSub}>{desc}</div>
                      ) : null}
                    </div>

                    <div style={{ alignItems: 'center', display: 'flex', flexShrink: 0, gap: 4 }}>
                      {m.abilities?.functionCall && (
                        <div className={styles.capIcon} title="Plugins">
                          <Plug size={11} />
                        </div>
                      )}
                      {m.abilities?.vision && (
                        <div className={styles.capIcon} title="Vision">
                          <Eye size={11} />
                        </div>
                      )}
                    </div>

                    {ctx && <span className={styles.ctx}>{ctx}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className={styles.empty}>{t('ModelSwitchPanel.emptySearch')}</div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className={styles.footer}>
        <div className={styles.tierLegend}>
          <span>
            <span className={styles.dot} style={{ background: '#22c55e' }} />{' '}
            {t('ModelSwitchPanel.legendFree')}
          </span>
          <span>
            <span className={styles.dot} style={{ background: '#a78bfa' }} />{' '}
            {t('ModelSwitchPanel.legendPro')}
          </span>
          <span>
            <span className={styles.dot} style={{ background: '#f59e0b' }} />{' '}
            {t('ModelSwitchPanel.legendMax')}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={panelContent}
      mouseEnterDelay={0.15}
      mouseLeaveDelay={0.4}
      onOpenChange={setOpen}
      open={isOpen}
      overlayInnerStyle={{ padding: '12px 16px' }}
      placement="topLeft"
      trigger="hover"
    >
      <div className={styles.trigger}>{children}</div>
    </Popover>
  );
});

export default ModelSwitchPanel;
