import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { SheetNode } from '@vtt/plugin-schema';

import {
  createMemoryStore,
  diffText,
  Sheet,
  SharedTextarea,
  type RichTextProps,
  type SharedText,
  type TextChange,
} from '../src/index.js';

/** A shared text in memory; `remote` edits it as another person would. */
function sharedText(initial: string) {
  let value = initial;
  const listeners = new Set<(changes: readonly TextChange[]) => void>();
  const splices: [number, number, string][] = [];
  const apply = (index: number, remove: number, insert: string) => {
    value = value.slice(0, index) + insert + value.slice(index + remove);
    for (const listener of listeners) listener([{ index, remove, insert: insert.length }]);
  };
  const text: SharedText = {
    read: () => value,
    splice: (index, remove, insert) => {
      splices.push([index, remove, insert]);
      apply(index, remove, insert);
    },
    observe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { text, splices, remote: apply };
}

describe('diffText', () => {
  it('finds the one splice between two texts', () => {
    expect(diffText('hello world', 'hello brave world')).toEqual({
      index: 6,
      remove: 0,
      insert: 'brave ',
    });
    expect(diffText('aaa', 'aa')).toEqual({ index: 2, remove: 1, insert: '' });
    expect(diffText('cat', 'cut')).toEqual({ index: 1, remove: 1, insert: 'u' });
    expect(diffText('same', 'same')).toEqual({ index: 4, remove: 0, insert: '' });
  });
});

describe('<SharedTextarea> (FR-SHEET-07)', () => {
  it('sends each input as a splice', async () => {
    const { text, splices } = sharedText('Likes tea.');
    render(<SharedTextarea id="n" text={text} readOnly={false} />);
    const area = screen.getByRole<HTMLTextAreaElement>('textbox');
    expect(area).toHaveValue('Likes tea.');
    area.setSelectionRange(5, 5);
    await userEvent.type(area, ' green', { initialSelectionStart: 5, initialSelectionEnd: 5 });
    expect(text.read()).toBe('Likes green tea.');
    expect(splices.every(([, remove, insert]) => remove === 0 && insert.length === 1)).toBe(true);
  });

  it('shows remote changes and keeps the caret where the viewer was typing', () => {
    const { text, remote } = sharedText('abcdef');
    render(<SharedTextarea id="n" text={text} readOnly={false} />);
    const area = screen.getByRole<HTMLTextAreaElement>('textbox');
    act(() => {
      area.focus();
      area.setSelectionRange(4, 4);
    });
    // Before the caret: it moves along; after it: it stays.
    act(() => {
      remote(1, 0, 'XY');
    });
    expect(area).toHaveValue('aXYbcdef');
    expect(area.selectionStart).toBe(6);
    act(() => {
      remote(7, 1, '');
    });
    expect(area).toHaveValue('aXYbcde');
    expect(area.selectionStart).toBe(6);
  });
});

describe('richText fields (ADR-037)', () => {
  const type = {
    schema: {
      type: 'object' as const,
      properties: {
        bio: { type: 'string' as const, 'x-kind': 'richText' as const },
        notes: { type: 'string' as const, 'x-kind': 'longText' as const },
      },
    },
  };
  const layout: SheetNode = {
    type: 'column',
    children: [
      { type: 'longText', path: 'bio', label: 'Biography' },
      { type: 'longText', path: 'notes', label: 'Notes' },
    ],
  };

  it('use the host editor, labelled by the field label', () => {
    const calls: RichTextProps[] = [];
    render(
      <Sheet
        pluginId="p"
        layout={layout}
        type={type}
        store={createMemoryStore({ bio: 'Born in Elm.' })}
        readOnly
        renderRichText={(props) => {
          calls.push(props);
          return <div role="textbox" aria-labelledby={props.labelId} />;
        }}
      />,
    );
    expect(calls.at(-1)).toMatchObject({ path: ['bio'], readOnly: true });
    expect(screen.getByRole('textbox', { name: 'Biography' })).not.toHaveValue();
    // Only richText fields go to the host; longText stays a text area.
    expect(screen.getByRole('textbox', { name: 'Notes' }).tagName).toBe('TEXTAREA');
  });

  it('fall back to a text area when the host renders nothing, or without a host', async () => {
    const store = createMemoryStore({ bio: 'Born' });
    const { unmount } = render(
      <Sheet pluginId="p" layout={layout} type={type} store={store} renderRichText={() => null} />,
    );
    const area = screen.getByRole('textbox', { name: 'Biography' });
    expect(area).toHaveValue('Born');
    await userEvent.type(area, '!');
    expect(store.getSnapshot()).toMatchObject({ bio: 'Born!' });
    unmount();
    render(<Sheet pluginId="p" layout={layout} type={type} store={store} />);
    expect(screen.getByRole('textbox', { name: 'Biography' }).tagName).toBe('TEXTAREA');
  });
});
