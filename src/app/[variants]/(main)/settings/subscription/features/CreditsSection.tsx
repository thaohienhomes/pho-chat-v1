'use client';

import { Card, Statistic, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useUsageStats } from '@/hooks/useUsageStats';
import { useUserStore } from '@/store/user';

const { Title } = Typography;

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadiusLG}px;
    color: ${token.colorText};
    background: ${token.colorBgContainer};
  `,
}));

const CreditsSection = memo(() => {
  const { styles, theme: token } = useStyles();

  // Use the same data source as the Usage page for correct adjusted balance
  const { stats, isLoading } = useUsageStats();
  // Read lifetimeSpent from user object (LobeUser)
  const lifetimeSpent = useUserStore((s) => s.user?.lifetimeSpent);
  const isInit = useUserStore((s) => s.isUserStateInit);

  if (!isInit || isLoading) return null;

  const balance = stats?.phoPointsBalance ?? 0;
  const spent = lifetimeSpent ?? 0;

  return (
    <Card className={styles.card} variant={'borderless'}>
      <Flexbox align={'center'} gap={16} horizontal justify={'space-between'} wrap={'wrap'}>
        <Flexbox>
          <Title level={4} style={{ color: token.colorText, margin: 0 }}>
            My Phở Credits
          </Title>
          <Typography.Text style={{ color: token.colorTextDescription }}>
            Số dư Phở Points khả dụng
          </Typography.Text>
        </Flexbox>

        <Flexbox align={'center'} gap={24} horizontal>
          <Statistic
            precision={0}
            suffix=" Points"
            title={<span style={{ color: token.colorTextDescription }}>Số Dư Hiện Tại</span>}
            value={balance.toLocaleString('vi-VN')}
            valueStyle={{
              color: balance > 0 ? token.colorSuccess : token.colorError,
              fontWeight: 'bold',
            }}
          />
          <Statistic
            precision={0}
            suffix=" Points"
            title={<span style={{ color: token.colorTextDescription }}>Đã Sử Dụng</span>}
            value={spent.toLocaleString('vi-VN')}
            valueStyle={{ color: token.colorText }}
          />
        </Flexbox>
      </Flexbox>
    </Card>
  );
});

export default CreditsSection;
