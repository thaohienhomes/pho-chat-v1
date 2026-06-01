import { SkeletonList } from '@/features/Conversation';

// PHO-92 (CLS): reuse the same skeleton the loaded list falls back to
// (ChatList Suspense fallback + VirtualizedList first-load). The previous
// bespoke full-width skeleton sat in a different container geometry
// (left-aligned, padding 16) than the real content (WideScreenContainer:
// centered, narrower, marginTop 24), so the loading -> content swap caused a
// horizontal + vertical layout shift. SkeletonList matches the real geometry.
export default () => <SkeletonList />;
