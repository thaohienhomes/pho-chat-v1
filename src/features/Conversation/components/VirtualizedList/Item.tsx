import { ItemProps } from 'react-virtuoso';

// PHO-92 (CLS) / observability: react-virtuoso re-measures every rendered item's
// `offsetHeight` through a ResizeObserver and logs
// `react-virtuoso: Zero-sized element, this should not happen` at ERROR severity
// (-> console.error -> PostHog via consoleErrorForwarding) whenever a *visible*
// item wrapper measures 0. In the chat list this fires transiently while an item
// is momentarily empty: the dynamic (ssr:false) ChatItem chunk is still loading,
// or a message id is briefly in `mainDisplayChatIDs` before its object lands in
// the store map during streaming / add / delete. Mobile samples that window far
// more often (URL-bar / soft-keyboard / dvh resizes fire the observer constantly),
// which is why ~93% of the errors are mobile. Flooring every item wrapper at 1px
// guarantees offsetHeight >= 1, so the spurious error — and the 0 -> real-height
// layout shift (CLS) it signals — never fire. Real messages are far taller, so the
// floor is layout-neutral.
//
// Kept in its own dependency-light module so it can be unit-tested without dragging
// the chat store (and its `@/utils/*` graph) through the vitest module resolver.
//
// `item` (the row data) is stripped: virtuoso passes it only to *custom* Item
// components, never to the default 'div' item, so dropping it keeps the rendered
// DOM identical to the default item apart from the 1px floor.
// eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
const Item = ({ item, style, ...props }: ItemProps<string>) => (
  <div {...props} style={{ ...style, minHeight: 1 }} />
);

export default Item;
