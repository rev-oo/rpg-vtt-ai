import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { documentLayout, ensureContainers } from '@vtt/plugin-engine';
import type { FieldSchema } from '@vtt/plugin-schema';

import { RichTextEditor } from '../src/collab/RichTextEditor.js';
import { createYjsStore, DATA_MAP } from '../src/collab/yjs-store.js';

const SCHEMA: FieldSchema = {
  type: 'object',
  properties: { bio: { type: 'string', 'x-kind': 'richText' } },
};
const LAYOUT = documentLayout(SCHEMA);

/** Two people's copies of one document, kept in sync as the server would. */
function syncedDocs() {
  const a = new Y.Doc();
  ensureContainers(a.getMap(DATA_MAP), LAYOUT.main);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  a.on('update', (update: Uint8Array) => {
    Y.applyUpdate(b, update);
  });
  b.on('update', (update: Uint8Array) => {
    Y.applyUpdate(a, update);
  });
  return { a, b };
}

const storeOf = (doc: Y.Doc) =>
  createYjsStore({ docs: { main: doc, secret: undefined }, layout: LAYOUT, adjust: vi.fn() });

function editorFor(doc: Y.Doc, { readOnly = false } = {}) {
  const fragment = storeOf(doc).richText(['bio']);
  if (!fragment) throw new Error('bio has no rich text');
  return render(
    <>
      <span id="bio-label">Biography</span>
      <RichTextEditor fragment={fragment} labelId="bio-label" readOnly={readOnly} className="" />
    </>,
  );
}

describe('rich text (ADR-037)', () => {
  it('gives the store the field’s fragment, and writes text as paragraphs', () => {
    const { a, b } = syncedDocs();
    const store = storeOf(a);
    const fragment = store.richText(['bio']);
    expect(fragment).toBeInstanceOf(Y.XmlFragment);
    store.set(['bio'], 'Born in Elm.\nRaised by wolves.');
    // The fragment is kept, so editors bound to it stay bound.
    expect(store.richText(['bio'])).toBe(fragment);
    expect(store.getSnapshot()).toEqual({ bio: 'Born in Elm.\nRaised by wolves.' });
    expect(storeOf(b).getSnapshot()).toEqual({ bio: 'Born in Elm.\nRaised by wolves.' });
    expect(store.text?.(['bio'])).toBeUndefined();
  });

  // Typing and the toolbar need a browser's layout; e2e covers them (live-sheets.spec.ts).
  it('shows other people’s changes, with their formatting', () => {
    const { a, b } = syncedDocs();
    editorFor(a);
    const editor = screen.getByRole('textbox', { name: 'Biography' });
    act(() => {
      storeOf(b).set(['bio'], 'Born in Elm.');
    });
    expect(editor).toHaveTextContent('Born in Elm.');
    act(() => {
      const fragment = b.getMap(DATA_MAP).get('bio');
      if (!(fragment instanceof Y.XmlFragment)) throw new Error('bio is not a fragment');
      const paragraph = fragment.get(0);
      if (paragraph instanceof Y.XmlElement) {
        const inner = paragraph.get(0);
        if (inner instanceof Y.XmlText) inner.format(0, 4, { bold: {} });
      }
    });
    expect(editor.querySelector('strong')).toHaveTextContent('Born');
  });

  it('is read-only without a toolbar for viewers who cannot edit', () => {
    const { a } = syncedDocs();
    editorFor(a, { readOnly: true });
    expect(screen.getByRole('textbox', { name: 'Biography' })).toHaveAttribute(
      'contenteditable',
      'false',
    );
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});

describe('images in journal text (T-1302, ADR-065)', () => {
  const withImage = () => {
    const doc = new Y.Doc();
    const image = new Y.XmlElement('image');
    image.setAttribute('src', '/api/v1/assets/11111111-1111-4111-8111-111111111111');
    image.setAttribute('alt', 'cave.png');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('The cave.')]);
    doc.getXmlFragment('body').insert(0, [paragraph, image]);
    return doc.getXmlFragment('body');
  };

  it('shows the images of an entry, and offers an image button to its editors', async () => {
    render(
      <>
        <span id="body-label">Body</span>
        <RichTextEditor
          fragment={withImage()}
          labelId="body-label"
          readOnly={false}
          className=""
          images
        />
      </>,
    );
    expect(await screen.findByRole('img', { name: 'cave.png' })).toHaveAttribute(
      'src',
      '/api/v1/assets/11111111-1111-4111-8111-111111111111',
    );
    expect(screen.getByRole('button', { name: 'Image' })).toBeVisible();
  });

  it('gives sheet fields no images', () => {
    render(
      <>
        <span id="bio-label">Biography</span>
        <RichTextEditor fragment={withImage()} labelId="bio-label" readOnly={false} className="" />
      </>,
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Image' })).toBeNull();
  });
});
