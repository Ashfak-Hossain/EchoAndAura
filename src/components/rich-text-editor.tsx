'use client';

import Link from '@tiptap/extension-link';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** Id of the editable area (what `<label for>` and the e2e specs target). */
  id: string;
  /** Field name on the submitted form. */
  name: string;
  /** Sanitised HTML (or '' for an empty editor). */
  defaultValue: string;
  /** Id of the visible label — the editable area is announced by it. */
  labelledBy: string;
  placeholder?: string;
  className?: string;
}

/**
 * Rich-text description field (ADR-010). Tiptap keeps the document; the
 * current HTML is mirrored into a controlled hidden input so a server action
 * round-trip cannot reset it (React only resets *uncontrolled* fields). The
 * toolbar exposes exactly the subset the server-side sanitiser allows —
 * anything else would be silently stripped on save.
 */
export function RichTextEditor({
  id,
  name,
  defaultValue,
  labelledBy,
  placeholder,
  className,
}: Props) {
  const [html, setHtml] = useState(defaultValue);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Not in the allowlist: keep the menu honest.
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: defaultValue,
    // SSR: render nothing on the server, mount on the client (avoids a
    // hydration mismatch — the form is inside a server-rendered page).
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelledBy,
        class: 'rich-text min-h-[240px] px-3.5 py-3 text-[15px] text-foreground outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      // Tiptap emits <p></p> for an empty document; the sanitiser turns that
      // into NULL server-side, so no special-casing here.
      setHtml(editor.getHTML());
    },
  });

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-md border border-input bg-card shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        className,
      )}
    >
      <input type="hidden" name={name} value={html} />
      <Toolbar editor={editor} />
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        // Same height as the mounted editor so nothing jumps when it appears.
        <div className="min-h-60 px-3.5 py-3 text-[15px] text-muted-foreground">
          {placeholder ?? ''}
        </div>
      )}
    </div>
  );
}

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  h2: boolean;
  h3: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/** Before the editor mounts (SSR / first client render). */
const IDLE: ToolbarState = {
  bold: false,
  italic: false,
  h2: false,
  h3: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  link: false,
  canUndo: false,
  canRedo: false,
};

function Toolbar({ editor }: { editor: Editor | null }) {
  // Subscribes to editor transactions so active states track the selection
  // without re-rendering the whole editor.
  const state =
    useEditorState({
      editor,
      // Every field is a boolean, so a shallow comparison skips no-op renders.
      selector: ({ editor }): ToolbarState => ({
        bold: editor?.isActive('bold') ?? false,
        italic: editor?.isActive('italic') ?? false,
        h2: editor?.isActive('heading', { level: 2 }) ?? false,
        h3: editor?.isActive('heading', { level: 3 }) ?? false,
        bulletList: editor?.isActive('bulletList') ?? false,
        orderedList: editor?.isActive('orderedList') ?? false,
        blockquote: editor?.isActive('blockquote') ?? false,
        link: editor?.isActive('link') ?? false,
        canUndo: editor?.can().undo() ?? false,
        canRedo: editor?.can().redo() ?? false,
      }),
    }) ?? IDLE;

  const setLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL (https://…)', previous ?? '');
    if (url === null) return;
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const disabled = !editor;
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/60 px-1.5 py-1"
    >
      <ToolButton
        label="Bold"
        active={state.bold}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={state.italic}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Heading"
        active={state.h2}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolButton>
      <ToolButton
        label="Subheading"
        active={state.h3}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Bullet list"
        active={state.bulletList}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={state.orderedList}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolButton>
      <ToolButton
        label="Quote"
        active={state.blockquote}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolButton>
      <Divider />
      <ToolButton label="Link" active={state.link} disabled={disabled} onClick={setLink}>
        <Link2 />
      </ToolButton>
      <div className="ml-auto flex items-center gap-0.5">
        <ToolButton
          label="Undo"
          disabled={disabled || !state.canUndo}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 />
        </ToolButton>
        <ToolButton
          label="Redo"
          disabled={disabled || !state.canRedo}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 />
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      disabled={disabled}
      // Keep the selection in the editor: mousedown would otherwise blur it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-foreground transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-foreground disabled:pointer-events-none disabled:text-[#a8a29a] [&_svg]:size-4',
        active && 'bg-foreground text-background hover:bg-[#33302a]',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border-strong" />;
}
