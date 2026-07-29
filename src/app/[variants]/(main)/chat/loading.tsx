import { Flexbox } from 'react-layout-kit';

import { SkeletonList } from '@/features/Conversation';

// PHO-92 (CLS): the previous full-screen brand spinner reserved none of the
// loaded workspace geometry, so the swap to the real shell (40px ChatHeader +
// centered message list) rearranged the whole viewport. Mirror that geometry
// here — a reserved header strip plus the same centered SkeletonList the
// conversation falls back to — so the loading -> loaded transition barely
// shifts. The session sidebar (@session) lives in the parent chat layout and
// is already painted, so it must NOT be reserved here.
export default () => (
  <Flexbox height={'100%'} width={'100%'}>
    {/* reserve ChatHeader height — see _layout/Desktop/ChatHeader (height: 40) */}
    <Flexbox flex={'none'} height={40} />
    <Flexbox flex={1} style={{ overflow: 'hidden', position: 'relative' }} width={'100%'}>
      <SkeletonList />
    </Flexbox>
  </Flexbox>
);
