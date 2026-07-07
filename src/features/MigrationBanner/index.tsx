'use client';

import { createStyles } from 'antd-style';
import { X } from 'lucide-react';
import Link from 'next/link';
import { memo, useEffect, useState } from 'react';

// ============================================================================
// EDIT COPY / LINK HERE — founder-editable
// ----------------------------------------------------------------------------
// Forward-looking wording: reads correctly BOTH before AND after the domain swap.
// Brand rule: NO em-dashes (use periods / commas).
// ============================================================================
// Field guide (keys are kept alphabetical to satisfy lint sort-keys):
//   lead ...................... opening sentence before the "try new version" link
//   newHome / newHomeLabel / newHomeUrl ... where the new version lives (pho.chat)
//   current / currentLabel / currentUrl / currentTail ... current app stays reachable (v1.pho.chat)
//   cta / ctaUrl .............. primary "try new version" button + destination
//   dismissAria ............... accessible label for the close (x) button
const COPY = {
  cta: 'Dùng thử bản mới',
  // NOTE: points to v2.pho.chat FOR NOW, because pho.chat still serves v1 until
  // the swap. AFTER the domain swap, change this to https://pho.chat.
  ctaUrl: 'https://v2.pho.chat',
  current: 'Bản hiện tại của bạn luôn truy cập được tại',
  currentLabel: 'v1.pho.chat',
  currentTail: 'với đầy đủ dữ liệu.',
  currentUrl: 'https://v1.pho.chat',
  dismissAria: 'Đóng thông báo',
  lead: 'Phở Chat sắp nâng cấp lên phiên bản mới, nhanh hơn và trả lời kèm trích dẫn nguồn thật.',
  newHome: 'Bản mới sẽ ở',
  newHomeLabel: 'pho.chat',
  newHomeUrl: 'https://pho.chat',
};

// localStorage key the founder can clear to re-show the banner during testing.
const DISMISS_KEY = 'pho_migration_notice_dismissed';

const JADE = '#059669';

const useStyles = createStyles(({ css, token, isDarkMode, responsive }) => ({
  bar: css`
    position: fixed;
    z-index: 1000;
    inset-block-start: 0;
    inset-inline: 0;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;

    min-height: 40px;
    padding-block: 6px;
    padding-inline: 44px 44px;
    border-block-end: 1px solid rgba(5, 150, 105, 35%);

    font-size: 13px;
    line-height: 1.4;
    color: ${isDarkMode ? 'rgba(255,255,255,0.92)' : token.colorText};
    text-align: center;

    background: ${isDarkMode ? 'rgba(5, 150, 105, 0.14)' : 'rgba(5, 150, 105, 0.10)'};
    backdrop-filter: blur(8px);

    ${responsive.mobile} {
      gap: 8px;
      padding-block: 8px;
      padding-inline: 40px 40px;
      font-size: 12px;
    }
  `,

  cta: css`
    flex: none;

    padding-block: 3px;
    padding-inline: 12px;
    border-radius: 8px;

    font-weight: 600;
    color: #fff;
    text-decoration: none;
    white-space: nowrap;

    background: ${JADE};

    transition: opacity 0.2s;

    &:hover {
      opacity: 0.88;
    }
  `,

  dismiss: css`
    cursor: pointer;

    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: 10px;
    transform: translateY(-50%);

    display: flex;
    align-items: center;
    justify-content: center;

    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 6px;

    color: ${token.colorTextSecondary};

    background: transparent;

    transition:
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${token.colorText};
      background: ${isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
    }
  `,

  link: css`
    font-weight: 600;
    color: ${JADE};
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  `,

  message: css`
    min-width: 0;

    ${responsive.mobile} {
      /* Keep the notice compact on small screens: hide the reassurance clause,
         keep the core upgrade message + CTA. */
      .migration-reassurance {
        display: none;
      }
    }
  `,
}));

const MigrationBanner = memo(() => {
  const { styles } = useStyles();

  // SSR-safe: render nothing until mounted so we never touch localStorage during
  // render and never cause a hydration mismatch. Default hidden.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) !== '1') setVisible(true);
    } catch {
      // localStorage unavailable (private mode / blocked): show anyway.
      setVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore write failures; still hide for this session.
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className={styles.bar} role="region">
      <span className={styles.message}>
        {COPY.lead} {COPY.newHome}{' '}
        <Link className={styles.link} href={COPY.newHomeUrl}>
          {COPY.newHomeLabel}
        </Link>
        .{' '}
        <span className="migration-reassurance">
          {COPY.current}{' '}
          <Link className={styles.link} href={COPY.currentUrl}>
            {COPY.currentLabel}
          </Link>{' '}
          {COPY.currentTail}
        </span>
      </span>
      <Link className={styles.cta} href={COPY.ctaUrl} rel="noopener" target="_blank">
        {COPY.cta}
      </Link>
      <button
        aria-label={COPY.dismissAria}
        className={styles.dismiss}
        onClick={handleDismiss}
        type="button"
      >
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
});

MigrationBanner.displayName = 'MigrationBanner';

export default MigrationBanner;
