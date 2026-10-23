import { useLayoutEffect, useRef, type ReactElement } from 'react';

import type { SharedText, TextChange } from './store.js';

/** Where a caret at `position` ends up after a change. */
function follow(position: number, { index, remove, insert }: TextChange): number {
  if (position <= index) return position;
  if (position >= index + remove) return position - remove + insert;
  return index + insert;
}

/** The single splice that turns `before` into `after`: the part between their common ends. */
export function diffText(
  before: string,
  after: string,
): { index: number; remove: number; insert: string } {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < shortest - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  return {
    index: start,
    remove: before.length - start - end,
    insert: after.slice(start, after.length - end),
  };
}

export interface SharedTextareaProps {
  id: string;
  text: SharedText;
  readOnly: boolean;
  className?: string;
}

/**
 * A text area bound to a shared text (FR-SHEET-07, T-0510). Each input becomes one splice;
 * other people's changes update the area and move the caret through them, so typing at the
 * same time loses nothing.
 */
export function SharedTextarea({
  id,
  text,
  readOnly,
  className,
}: SharedTextareaProps): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.value = text.read();
    return text.observe((changes) => {
      const value = text.read();
      // Our own splices are already in the area.
      if (area.value === value) return;
      const focused = area.ownerDocument.activeElement === area;
      let start = area.selectionStart;
      let end = area.selectionEnd;
      for (const change of changes) {
        start = follow(start, change);
        end = follow(end, change);
      }
      area.value = value;
      if (focused) area.setSelectionRange(start, end);
    });
  }, [text]);

  return (
    <textarea
      ref={ref}
      id={id}
      className={className}
      readOnly={readOnly}
      onInput={(event) => {
        const { index, remove, insert } = diffText(text.read(), event.currentTarget.value);
        if (remove > 0 || insert) text.splice(index, remove, insert);
      }}
    />
  );
}
