import { Skeleton } from 'antd';
import { Flexbox } from 'react-layout-kit';

export default () => (
  <Flexbox flex={1} height={'100%'} style={{ position: 'relative' }} width={'100%'}>
    <Flexbox flex={1} gap={16} padding={16}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton active avatar key={i} paragraph={{ rows: 2 }} />
      ))}
    </Flexbox>
  </Flexbox>
);
