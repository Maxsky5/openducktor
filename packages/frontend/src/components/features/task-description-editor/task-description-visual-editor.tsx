import type { TaskAssetRenderContext, TaskAssetStageResult } from "@openducktor/contracts";
import { CodeBlock } from "@tiptap/extension-code-block";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Mathematics } from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Braces,
  Code,
  Heading2,
  ImagePlus,
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
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  TaskDescriptionImageContext,
  TaskDescriptionImageNode,
} from "./task-description-image-node";
import { TaskDescriptionMermaidNode } from "./task-description-mermaid-node";

const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskDescriptionMermaidNode);
  },
});

const VisualImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskDescriptionImageNode);
  },
});

type TaskDescriptionVisualEditorProps = {
  body: string;
  frontMatter: string;
  onChange(markdown: string): void;
  onUpload(file: File): Promise<TaskAssetStageResult>;
  renderContext: Omit<TaskAssetRenderContext, "assetId"> | null;
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

export default function TaskDescriptionVisualEditor({
  body,
  frontMatter,
  onChange,
  onUpload,
  renderContext,
}: TaskDescriptionVisualEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFilesRef = useRef<(files: File[]) => void>(() => {});
  const hydratedBody = useRef(body);
  const [uploading, setUploading] = useState(false);
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(new Map());
  const previewUrls = useRef(new Map<string, string>());
  const imageContext = useMemo(() => ({ previews, renderContext }), [previews, renderContext]);

  useEffect(
    () => () => {
      for (const previewUrl of previewUrls.current.values()) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrls.current.clear();
    },
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false }),
      Link.configure({ openOnClick: false }),
      MermaidCodeBlock,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      VisualImage.configure({ allowBase64: false }),
      Mathematics,
      Markdown.configure({ markedOptions: { gfm: true } }),
    ],
    content: body,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class:
          "min-h-64 max-w-none px-4 py-3 text-sm text-foreground outline-none prose prose-sm prose-headings:text-foreground prose-p:my-2 prose-li:my-0.5 prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:border-input prose-blockquote:text-foreground",
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        uploadFilesRef.current(files);
        return true;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        uploadFilesRef.current(files);
        return true;
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const nextBody = updatedEditor.getMarkdown();
      hydratedBody.current = nextBody;
      onChange(`${frontMatter}${nextBody}`);
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || hydratedBody.current === body) {
      return;
    }
    editor.commands.setContent(body, { contentType: "markdown", emitUpdate: false });
    hydratedBody.current = body;
  }, [body, editor]);

  uploadFilesRef.current = (files) => {
    if (!editor || uploading) return;
    setUploading(true);
    void (async () => {
      try {
        for (const file of files) {
          const staged = await onUpload(file);
          const previewUrl = URL.createObjectURL(file);
          previewUrls.current.set(staged.assetId, previewUrl);
          setPreviews(new Map(previewUrls.current));
          editor
            .chain()
            .focus()
            .setImage({
              src: `odt-asset:${staged.assetId}`,
              alt: file.name.replace(/\.[^.]+$/, ""),
              title: file.name,
            })
            .run();
        }
      } catch {
        // The parent owns the actionable upload error message.
      } finally {
        setUploading(false);
      }
    })();
  };

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current || current.isDestroyed) {
        return {
          bold: false,
          italic: false,
          strike: false,
          code: false,
          heading: false,
          bulletList: false,
          orderedList: false,
          taskList: false,
          blockquote: false,
          canUndo: false,
          canRedo: false,
        };
      }
      return {
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        strike: current.isActive("strike"),
        code: current.isActive("code"),
        heading: current.isActive("heading", { level: 2 }),
        bulletList: current.isActive("bulletList"),
        orderedList: current.isActive("orderedList"),
        taskList: current.isActive("taskList"),
        blockquote: current.isActive("blockquote"),
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
      };
    },
  });

  if (!editor) {
    return <div className="min-h-64 animate-pulse rounded-md bg-muted" />;
  }

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
    <div className="overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/40">
      <div className="flex flex-wrap gap-0.5 border-b border-border bg-muted/30 p-1.5">
        <ToolbarButton
          label="Undo"
          disabled={!toolbar.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          disabled={!toolbar.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="size-4" />
        </ToolbarButton>
        <span className="mx-1 w-px bg-border" />
        <ToolbarButton
          label="Paragraph"
          onClick={() => editor.chain().focus().setParagraph().run()}
        >
          <Pilcrow className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 2"
          active={toolbar.heading}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Bold"
          active={toolbar.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={toolbar.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={toolbar.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Inline code"
          active={toolbar.code}
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
          active={toolbar.bulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={toolbar.orderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Task list"
          active={toolbar.taskList}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListChecks className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Blockquote"
          active={toolbar.blockquote}
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
        <ToolbarButton
          label={uploading ? "Uploading image" : "Insert image"}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className={cn("size-4", uploading && "animate-pulse")} />
        </ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(event) => {
            uploadFilesRef.current(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
      </div>
      <TaskDescriptionImageContext.Provider value={imageContext}>
        <EditorContent editor={editor} />
      </TaskDescriptionImageContext.Provider>
    </div>
  );
}
