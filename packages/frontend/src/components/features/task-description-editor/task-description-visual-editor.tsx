import "katex/dist/katex.min.css";
import type { TaskAssetRenderContext, TaskAssetStageResult } from "@openducktor/contracts";
import type { Editor } from "@tiptap/core";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Mathematics } from "@tiptap/extension-mathematics";
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from "@tiptap/react";
import { ImagePlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import type { IssueImageContext } from "@/components/features/issue-source/github-issue-image";
import { MermaidPreviewProvider } from "@/components/ui/markdown-mermaid";
import type { MermaidPreviews } from "@/components/ui/markdown-mermaid-state";
import { cn } from "@/lib/utils";
import { TaskDescriptionEditorLoading } from "./task-description-editor-loading";
import { TaskDescriptionFormattingToolbar } from "./task-description-formatting-toolbar";
import {
  TaskDescriptionImageContext,
  type MarkdownImageRenderer,
} from "./task-description-image-context";
import { TaskDescriptionImageNode } from "./task-description-image-node";
import { TaskDescriptionLinkDialog } from "./task-description-link-dialog";
import {
  createTaskDescriptionMarkdownExtensions,
  TaskDescriptionImage,
} from "./task-description-markdown-extensions";
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

const VisualImage = TaskDescriptionImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskDescriptionImageNode);
  },
});

type TaskDescriptionVisualEditorProps = {
  body: string;
  disabled: boolean;
  frontMatter: string;
  onChange(markdown: string): void;
  onUpload?: ((file: File) => Promise<TaskAssetStageResult>) | undefined;
  renderContext: Omit<TaskAssetRenderContext, "assetId"> | null;
  issueImageContext?: IssueImageContext | undefined;
  renderImage?: MarkdownImageRenderer | undefined;
  uploads: TaskDescriptionAssetUpload[];
  previews: ReadonlyMap<string, string>;
  mermaidPreviews: MermaidPreviews;
};

export default function TaskDescriptionVisualEditor({
  body,
  disabled,
  frontMatter,
  onChange,
  onUpload,
  renderContext,
  issueImageContext,
  renderImage,
  uploads,
  previews,
  mermaidPreviews,
}: TaskDescriptionVisualEditorProps) {
  const uploading = uploads.some((upload) => upload.status === "uploading");
  const canEdit = !disabled && !uploading;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFilesRef = useRef<(files: File[]) => void>(() => {});
  const disabledRef = useRef(disabled);
  const canEditRef = useRef(canEdit);
  const hydratedBody = useRef(body);
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [mathEdit, setMathEdit] = useState<TaskDescriptionMathEdit | null>(null);
  const openMathEditor = useCallback((edit: TaskDescriptionMathEdit) => {
    if (canEditRef.current) setMathEdit(edit);
  }, []);
  const imageContext = useMemo(
    () => ({ previews, renderContext, issueImageContext, renderImage }),
    [previews, renderContext, issueImageContext, renderImage],
  );

  const editor = useEditor({
    editable: canEdit,
    extensions: createTaskDescriptionMarkdownExtensions({
      codeBlock: MermaidCodeBlock,
      image: VisualImage,
      mathematics: Mathematics.configure({
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
    }),
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
      if (nextBody === hydratedBody.current) return;
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

  useEffect(() => {
    disabledRef.current = disabled;
    canEditRef.current = canEdit;
    return () => {
      // Tiptap defers destruction, so pending callbacks must stop at unmount.
      disabledRef.current = true;
      canEditRef.current = false;
    };
  }, [canEdit, disabled]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isEditable === canEdit) {
      return;
    }
    editor.setEditable(canEdit);
  }, [canEdit, editor]);

  const uploadFiles = useCallback(
    (files: File[]): void => {
      if (!editor || !canEdit || !onUpload || files.length === 0) return;
      const insertAt = editor.state.selection.from;
      void Promise.allSettled(files.map((file) => onUpload(file))).then((results) => {
        if (editor.isDestroyed || disabledRef.current) return;
        const images = results.flatMap((result, index) => {
          const file = files[index];
          if (result.status === "rejected" || !file) return [];
          return [
            {
              type: "image",
              attrs: {
                src: `odt-asset:${result.value.assetId}`,
                alt: file.name.replace(/\.[^.]+$/, ""),
                title: file.name,
              },
            },
          ];
        });
        if (images.length > 0) {
          editor.chain().focus().insertContentAt(insertAt, images).run();
        }
      });
    },
    [canEdit, editor, onUpload],
  );

  useEffect(() => {
    uploadFilesRef.current = uploadFiles;
  }, [uploadFiles]);

  const uploadImages = (files: FileList, preventDefault: () => void): void => {
    if (!canEdit) {
      preventDefault();
      return;
    }
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    preventDefault();
    uploadFilesRef.current(images);
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
          link: false,
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
        link: current.isActive("link"),
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
    return <TaskDescriptionEditorLoading />;
  }

  return (
    <div className="overflow-hidden rounded-md border border-input bg-card focus-within:ring-2 focus-within:ring-ring/40">
      <fieldset disabled={!canEdit} className="min-w-0 border-0 p-0">
        <div className="flex flex-wrap gap-0.5 border-b border-border bg-muted/30 p-1.5">
          <TaskDescriptionFormattingToolbar
            editor={editor}
            state={toolbar}
            onEditLink={() => {
              if (!canEditRef.current) return;
              const href = editor.getAttributes("link").href;
              const hrefResult = z.string().safeParse(href);
              setLinkHref(hrefResult.success ? hrefResult.data : "");
            }}
            onEditMath={(kind) => openMathEditor({ kind, latex: "" })}
          />
          {onUpload ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={uploading ? "Uploading image" : "Insert image"}
                title={uploading ? "Uploading image" : "Insert image"}
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
            </>
          ) : null}
        </div>
      </fieldset>
      <TaskDescriptionImageContext.Provider value={imageContext}>
        <MermaidPreviewProvider previews={mermaidPreviews}>
          <EditorContent
            editor={editor}
            onDrop={(event) => uploadImages(event.dataTransfer.files, () => event.preventDefault())}
            onPaste={(event) =>
              uploadImages(event.clipboardData.files, () => event.preventDefault())
            }
          />
        </MermaidPreviewProvider>
      </TaskDescriptionImageContext.Provider>
      {linkHref !== null ? (
        <TaskDescriptionLinkDialog
          key={linkHref || "new"}
          href={linkHref}
          disabled={!canEdit}
          onCancel={() => setLinkHref(null)}
          onRemove={() => {
            if (!canEditRef.current) return;
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            setLinkHref(null);
          }}
          onSubmit={(href) => {
            if (!canEditRef.current) return false;
            const applied = editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
            if (applied) {
              setLinkHref(null);
            }
            return applied;
          }}
        />
      ) : null}
      {mathEdit ? (
        <TaskDescriptionMathDialog
          key={`${mathEdit.kind}:${mathEdit.position ?? "new"}`}
          edit={mathEdit}
          disabled={!canEdit}
          onCancel={() => setMathEdit(null)}
          onSubmit={(latex) => {
            if (!canEditRef.current) return false;
            const applied = applyMathEdit(editor, mathEdit, latex);
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

function applyMathEdit(editor: Editor, edit: TaskDescriptionMathEdit, latex: string): boolean {
  const chain = editor.chain().focus();
  if (edit.kind === "inline") {
    if (edit.position === undefined) {
      return chain.insertInlineMath({ latex }).run();
    }
    return chain.updateInlineMath({ latex, pos: edit.position }).run();
  }
  if (edit.position === undefined) {
    return chain.insertBlockMath({ latex }).run();
  }
  return chain.updateBlockMath({ latex, pos: edit.position }).run();
}
