import Collaboration from '@tiptap/extension-collaboration';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, type ReactElement } from 'react';
import type * as Y from 'yjs';

import type { RichTextProps } from '@vtt/sheet-renderer';
import { cn } from '@vtt/ui';

import { t, type MessageKey } from '../i18n/index.js';

type Format = 'bold' | 'italic' | 'heading' | 'bulletList' | 'orderedList';

const FORMATS: readonly {
  format: Format;
  label: MessageKey;
  text: string;
  run: (editor: Editor) => void;
}[] = [
  {
    format: 'bold',
    label: 'richText.bold',
    text: 'B',
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    format: 'italic',
    label: 'richText.italic',
    text: 'I',
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    format: 'heading',
    label: 'richText.heading',
    text: 'H',
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    format: 'bulletList',
    label: 'richText.bulletList',
    text: '•',
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    format: 'orderedList',
    label: 'richText.orderedList',
    text: '1.',
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
];

/**
 * The editor of a `richText` field (ADR-037): TipTap bound to the field's `Y.XmlFragment`, so
 * several people edit it at once. Formatting comes from the toolbar, keyboard shortcuts and
 * Markdown-like input rules; links are made from typed or pasted URLs.
 */
export function RichTextEditor({
  fragment,
  labelId,
  readOnly,
  className,
}: Omit<RichTextProps, 'path'> & { fragment: Y.XmlFragment }): ReactElement {
  const editor = useEditor(
    {
      extensions: [
        // Collaboration brings its own undo, which only undoes this viewer's changes.
        StarterKit.configure({
          undoRedo: false,
          link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
        }),
        Collaboration.configure({ fragment }),
      ],
      editable: !readOnly,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-labelledby': labelId,
          class: cn(className, 'vtt-rich-text'),
        },
      },
    },
    [fragment, labelId, className],
  );
  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }): Record<Format, boolean> => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      heading: current.isActive('heading'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
    }),
  });

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {!readOnly && (
        <div role="toolbar" aria-label={t('richText.toolbar')} className="flex flex-wrap gap-1">
          {FORMATS.map(({ format, label, text, run }) => (
            <button
              key={format}
              type="button"
              aria-label={t(label)}
              title={t(label)}
              aria-pressed={active[format]}
              className="min-h-8 min-w-8 cursor-pointer rounded border border-line px-2 text-sm font-semibold hover:bg-canvas aria-pressed:bg-canvas aria-pressed:text-primary"
              onClick={() => {
                run(editor);
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
