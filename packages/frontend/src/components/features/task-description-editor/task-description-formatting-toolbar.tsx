import type { Editor } from "@tiptap/core";
import {
  Bold,
  Braces,
  Code,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Sigma,
  Strikethrough,
  Table2,
  Undo2,
} from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";

export type TaskDescriptionToolbarState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  heading: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

const ToolbarButton = ({
  active = false,
  disabled = false,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick(): void;
  children: ReactElement;
}) => (
  <Button
    type="button"
    variant={active ? "secondary" : "ghost"}
    size="icon"
    className="size-8"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </Button>
);

export function TaskDescriptionFormattingToolbar({
  editor,
  state,
}: {
  editor: Editor;
  state: TaskDescriptionToolbarState;
}): ReactElement {
  const setLink = (): void => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL", previous ?? "https://");
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };

  return (
    <>
      <ToolbarButton
        label="Undo"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="size-4" />
      </ToolbarButton>
      <span className="mx-1 w-px bg-border" />
      <ToolbarButton label="Paragraph" onClick={() => editor.chain().focus().setParagraph().run()}>
        <Pilcrow className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 2"
        active={state.heading}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Bold"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Link" onClick={setLink}>
        <LinkIcon className="size-4" />
      </ToolbarButton>
      <span className="mx-1 w-px bg-border" />
      <ToolbarButton
        label="Bullet list"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Task list"
        active={state.taskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListChecks className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Blockquote"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Braces className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Horizontal rule"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Table"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <Table2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Inline math"
        onClick={() => editor.chain().focus().insertInlineMath({ latex: "x" }).run()}
      >
        <Sigma className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Block math"
        onClick={() => editor.chain().focus().insertBlockMath({ latex: "x^2" }).run()}
      >
        <Sigma className="size-4 stroke-[2.5]" />
      </ToolbarButton>
      <ToolbarButton
        label="Mermaid diagram"
        onClick={() =>
          editor
            .chain()
            .focus()
            .setCodeBlock({ language: "mermaid" })
            .insertContent("graph TD\n  A --> B")
            .run()
        }
      >
        <Braces className="size-4" />
      </ToolbarButton>
    </>
  );
}
