'use client';

import { createStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { Center } from 'react-layout-kit';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    position: absolute;
    z-index: 1;
    inset: 0;

    background: ${token.colorBgContainer};

    transition: opacity 0.3s ease;
  `,
  dot: css`
    display: inline-block;
    animation: dot-pulse 1.4s ease-in-out infinite;

    @keyframes dot-pulse {
      0%,
      80%,
      100% {
        opacity: 0.3;
      }

      40% {
        opacity: 1;
      }
    }
  `,
  text: css`
    user-select: none;
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
}));

interface LoadingOverlayProps {
  messages: string[];
}

const CYCLE_INTERVAL_MS = 2500;

const LoadingOverlay = memo<LoadingOverlayProps>(({ messages }) => {
  const { styles } = useStyles();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;

    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, CYCLE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [messages.length]);

  const text = messages[index] || messages[0] || '';

  return (
    <Center className={styles.container} gap={4}>
      <span className={styles.text}>
        {text}
        <span className={styles.dot} style={{ animationDelay: '0s' }}>
          .
        </span>
        <span className={styles.dot} style={{ animationDelay: '0.2s' }}>
          .
        </span>
        <span className={styles.dot} style={{ animationDelay: '0.4s' }}>
          .
        </span>
      </span>
    </Center>
  );
});

LoadingOverlay.displayName = 'LoadingOverlay';

export default LoadingOverlay;
