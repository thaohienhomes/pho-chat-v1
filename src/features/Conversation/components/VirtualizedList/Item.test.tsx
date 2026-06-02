import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Item from './Item';

// Regression guard for the react-virtuoso "Zero-sized element, this should not
// happen" console.error storm (~400/day, 93% mobile) + the related /chat CLS.
// react-virtuoso measures each rendered item's offsetHeight and logs an ERROR
// when it is 0. Chat items render momentarily empty (dynamic ssr:false chunk
// still loading, or a message id present in `mainDisplayChatIDs` before its
// object lands in the store map during streaming). Flooring the item wrapper at
// 1px keeps offsetHeight >= 1 so the spurious error never fires.
describe('VirtualizedList <Item>', () => {
  const baseProps = {
    'data-index': 0,
    'data-item-index': 0,
    'data-known-size': 0,
    'item': 'msg_1',
  } as const;

  it('floors an empty item wrapper at min-height 1px so it never measures 0', () => {
    const { container } = render(<Item {...baseProps}>{null}</Item>);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.minHeight).toBe('1px');
  });

  it("preserves virtuoso's positioning style + data attrs and drops the item data prop", () => {
    const { container } = render(
      <Item
        {...baseProps}
        data-index={3}
        data-known-size={88}
        item="msg_42"
        style={{ transform: 'translateY(120px)' }}
      >
        <span>message</span>
      </Item>,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    // Virtuoso's own positioning style must survive...
    expect(wrapper.style.transform).toBe('translateY(120px)');
    // ...alongside the 1px floor...
    expect(wrapper.style.minHeight).toBe('1px');
    // ...and the data-* attributes virtuoso reads back for virtualization.
    expect(wrapper.dataset.index).toBe('3');
    expect(wrapper.dataset.knownSize).toBe('88');
    // The row data must NOT leak onto the DOM (matches the default 'div' item).
    expect(wrapper.hasAttribute('item')).toBe(false);
    expect(wrapper.textContent).toBe('message');
  });
});
