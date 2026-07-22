import "katex/dist/katex.min.css";
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
import { ImagePlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TaskDescriptionFormattingToolbar } from "./task-description-formatting-toolbar";
import { TaskDescriptionImageContext } from "./task-description-image-context";
import { TaskDescriptionImageNode } from "./task-description-image-node";
import {
  TaskDescriptionMathDialog,
  type TaskDescriptionMathEdit,
} from "./task-description-math-dialog";
import { TaskDescriptionMermaidNode } from "./task-description-mermaid-node";
import type { TaskDescriptionAssetUpload } from "./use-task-description-asset-draft";

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
  uploads: TaskDescriptionAssetUpload[];
  previews: ReadonlyMap<string, string>;
};

export default function TaskDescriptionVisualEditor({
  body,
  frontMatter,
  onChange,
  onUpload,
  renderContext,
  uploads,
  previews,
}: TaskDescriptionVisualEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFilesRef = useRef<(files: File[]) => void>(() => {});
  const hydratedBody = useRef(body);
  const [mathEdit, setMathEdit] = useState<TaskDescriptionMathEdit | null>(null);
  const openMathEditor = useCallback((edit: TaskDescriptionMathEdit) => setMathEdit(edit), []);
  const uploading = uploads.some((upload) => upload.status === "uploading");
  const imageContext = useMemo(() => ({ previews, renderContext }), [previews, renderContext]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false }),
      Link.configure({ openOnClick: false }),
      MermaidCodeBlock,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      VisualImage.configure({ allowBase64: false }),
      Mathematics.configure({
        inlineOptions: {
          onClick: (node, position) =>
            openMathEditor({
              kind: "inline",
              latex: String(node.attrs.latex ?? ""),
              position,
            }),
        },
        blockOptions: {
          onClick: (node, position) =>
            openMathEditor({
              kind: "block",
              latex: String(node.attrs.latex ?? ""),
              position,
            }),
        },
      }),
      Markdown.configure({ markedOptions: { gfm: true } }),
    ],
    content: body,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class:
          "min-h-64 max-w-none px-4 py-3 text-sm text-foreground outline-none prose prose-sm prose-headings:text-foreground prose-p:my-2 prose-li:my-0.5 prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:border-input prose-blockquote:text-foreground",
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

  const uploadFiles = useCallback(
    (files: File[]): void => {
      if (!editor || uploading) return;
      void Promise.allSettled(
        files.map(async (file) => {
          const staged = await onUpload(file);
          editor
            .chain()
            .focus()
            .setImage({
              src: `odt-asset:${staged.assetId}`,
              alt: file.name.replace(/\.[^.]+$/, ""),
              title: file.name,
            })
            .run();
        }),
      );
    },
    [editor, onUpload, uploading],
  );

  useEffect(() => {
    uploadFilesRef.current = uploadFiles;
  }, [uploadFiles]);

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

  return (
    <div className="overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/40">
      <div className="flex flex-wrap gap-0.5 border-b border-border bg-muted/30 p-1.5">
        <TaskDescriptionFormattingToolbar
          editor={editor}
          state={toolbar}
          onEditMath={(kind) => setMathEdit({ kind, latex: "" })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={uploading ? "Uploading image" : "Insert image"}
          title={uploading ? "Uploading image" : "Insert image"}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className={cn("size-4", uploading && "animate-pulse")} />
        </Button>
        <input
          ref={fileInputRef}
          aria-label="Task description images"
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
        <EditorContent
          editor={editor}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length === 0) return;
            event.preventDefault();
            uploadFilesRef.current(files);
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length === 0) return;
            event.preventDefault();
            uploadFilesRef.current(files);
          }}
        />
      </TaskDescriptionImageContext.Provider>
      {mathEdit ? (
        <TaskDescriptionMathDialog
          key={`${mathEdit.kind}:${mathEdit.position ?? "new"}`}
          edit={mathEdit}
          onCancel={() => setMathEdit(null)}
          onSubmit={(latex) => {
            const chain = editor.chain().focus();
            let applied: boolean;
            if (mathEdit.kind === "inline") {
              applied =
                mathEdit.position === undefined
                  ? chain.insertInlineMath({ latex }).run()
                  : chain.updateInlineMath({ latex, pos: mathEdit.position }).run();
            } else {
              applied =
                mathEdit.position === undefined
                  ? chain.insertBlockMath({ latex }).run()
                  : chain.updateBlockMath({ latex, pos: mathEdit.position }).run();
            }
            if (applied) {
              setMathEdit(null);
            }
            return applied;
          }}
        />
      ) : null}
    </div>
  );
}
