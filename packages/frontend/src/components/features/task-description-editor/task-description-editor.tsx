import type { TaskAssetStageResult } from "@openducktor/contracts";
import { AlertCircle, Code2, Eye, ImagePlus, Info } from "lucide-react";
import { lazy, type ReactElement, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MermaidPreviews } from "@/components/ui/markdown-mermaid-state";
import { Textarea } from "@/components/ui/textarea";
import { TaskDescriptionEditorLoading } from "./task-description-editor-loading";
import { splitTaskDescriptionFrontMatter } from "./task-description-front-matter";
import type { VisualMarkdownCompatibility } from "./task-description-markdown-compatibility";
import type { TaskDescriptionAssetUpload } from "./use-task-description-asset-draft";

const loadTaskDescriptionMarkdown = () => import("./task-description-markdown");
const loadTaskDescriptionVisualEditor = () => import("./task-description-visual-editor");
const TaskDescriptionVisualEditor = lazy(loadTaskDescriptionVisualEditor);

type TaskDescriptionEditorProps = {
  markdown: string;
  workspaceId: string | null;
  taskId: string | null;
  onChange(markdown: string): void;
  onUpload(file: File): Promise<TaskAssetStageResult>;
  uploads: TaskDescriptionAssetUpload[];
  previews: ReadonlyMap<string, string>;
};

function TaskDescriptionEditorSession({
  markdown,
  workspaceId,
  taskId,
  onChange,
  onUpload,
  uploads,
  previews,
}: TaskDescriptionEditorProps): ReactElement {
  const [mode, setMode] = useState<"auto" | "visual" | "markdown">("auto");
  const [compatibilityState, setCompatibilityState] = useState<{
    markdown: string;
    result: VisualMarkdownCompatibility | null;
    mermaidPreviews: MermaidPreviews;
  }>({ markdown, result: null, mermaidPreviews: new Map() });
  const lastVisualChange = useRef<string | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const sourceInsertionOffset = useRef(0);
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const frontMatter = splitTaskDescriptionFrontMatter(markdown);
  const compatibilityIsCurrent =
    compatibilityState.markdown === markdown && compatibilityState.result !== null;
  const renderContext = useMemo(
    () => (workspaceId && taskId ? { workspaceId, taskId, scope: "description" as const } : null),
    [taskId, workspaceId],
  );

  useEffect(() => {
    if (lastVisualChange.current === markdown) {
      lastVisualChange.current = null;
      setCompatibilityState({ markdown, result: { compatible: true }, mermaidPreviews: new Map() });
      return;
    }
    if (mode === "markdown" || compatibilityIsCurrent) {
      return;
    }
    let active = true;
    setCompatibilityState({ markdown, result: null, mermaidPreviews: new Map() });
    void (async () => {
      try {
        const [{ assessVisualMarkdownCompatibility }] = await Promise.all([
          loadTaskDescriptionMarkdown(),
          loadTaskDescriptionVisualEditor(),
        ]);
        const result = assessVisualMarkdownCompatibility(markdown);
        if (!result.compatible) {
          if (active) {
            setCompatibilityState({ markdown, result, mermaidPreviews: new Map() });
          }
          return;
        }
        if (!active) {
          return;
        }
        setCompatibilityState({
          markdown,
          result,
          mermaidPreviews: new Map(),
        });
      } catch {
        if (active) {
          setCompatibilityState({
            markdown,
            result: {
              compatible: false,
              reason:
                "Visual mode could not load its Markdown compatibility check. Keep editing in Markdown mode and retry after reloading the app.",
            },
            mermaidPreviews: new Map(),
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [compatibilityIsCurrent, markdown, mode]);

  let compatibility: VisualMarkdownCompatibility | null = null;
  if (lastVisualChange.current === markdown) {
    compatibility = { compatible: true };
  } else if (compatibilityState.markdown === markdown) {
    compatibility = compatibilityState.result;
  }
  const visualAllowed = compatibility?.compatible === true;
  const checkingVisual = mode !== "markdown" && compatibility === null;
  let effectiveMode: "loading" | "markdown" | "visual" = "markdown";
  if (checkingVisual) {
    effectiveMode = "loading";
  } else if ((mode === "visual" || mode === "auto") && visualAllowed) {
    effectiveMode = "visual";
  }
  const effectiveGateMessage =
    compatibility && !compatibility.compatible ? compatibility.reason : null;

  const enterVisualMode = (): void => {
    if (visualAllowed) {
      setMode("visual");
      return;
    }
    if (compatibilityState.markdown !== markdown) {
      setMode("auto");
    }
  };

  const stageImage = async (file: File): Promise<TaskAssetStageResult> => {
    if (!workspaceId) {
      throw new Error("Select a workspace before adding task images.");
    }
    return onUpload(file);
  };

  const uploading = uploads.some((upload) => upload.status === "uploading");
  const uploadSourceFiles = (files: File[]): void => {
    if (uploading || files.length === 0) {
      return;
    }
    const insertAt = sourceInsertionOffset.current;
    void Promise.allSettled(files.map(stageImage)).then((results) => {
      const images = results.flatMap((result, index) => {
        const file = files[index];
        if (result.status === "rejected" || !file) {
          return [];
        }
        const alt = file.name.replace(/\.[^.]+$/, "").replace(/([\\[\]])/g, "\\$1");
        const title = file.name.replace(/([\\"])/g, "\\$1");
        return [`![${alt}](odt-asset:${result.value.assetId} "${title}")`];
      });
      if (images.length === 0) {
        return;
      }
      const currentMarkdown = sourceTextareaRef.current?.value ?? markdown;
      const offset = Math.min(insertAt, currentMarkdown.length);
      const before = currentMarkdown.slice(0, offset);
      const after = currentMarkdown.slice(offset);
      const leadingBreak = before && !before.endsWith("\n") ? "\n\n" : "";
      const trailingBreak = after && !after.startsWith("\n") ? "\n\n" : "";
      onChange(`${before}${leadingBreak}${images.join("\n")}${trailingBreak}${after}`);
    });
  };

  const hasPreservedFrontMatter = frontMatter.kind === "valid";
  const visualBody = frontMatter.kind === "valid" ? frontMatter.body : markdown;
  const preservedPrefix = frontMatter.kind === "valid" ? frontMatter.raw : "";
  let editorContent: ReactElement;
  if (effectiveMode === "loading") {
    editorContent = <TaskDescriptionEditorLoading />;
  } else if (effectiveMode === "visual") {
    editorContent = (
      <Suspense fallback={<TaskDescriptionEditorLoading />}>
        <TaskDescriptionVisualEditor
          body={visualBody}
          frontMatter={preservedPrefix}
          onChange={(nextMarkdown) => {
            lastVisualChange.current = nextMarkdown;
            onChange(nextMarkdown);
          }}
          onUpload={stageImage}
          uploads={uploads}
          previews={previews}
          mermaidPreviews={compatibilityState.mermaidPreviews}
          renderContext={renderContext}
        />
      </Suspense>
    );
  } else {
    editorContent = (
      <div className="overflow-hidden rounded-md border border-input bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
        <div className="flex items-center border-b border-border bg-muted/30 p-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={uploading}
            onClick={() => {
              sourceInsertionOffset.current =
                sourceTextareaRef.current?.selectionStart ?? markdown.length;
              sourceFileInputRef.current?.click();
            }}
          >
            <ImagePlus className="size-4" /> {uploading ? "Uploading image" : "Insert image"}
          </Button>
          <input
            ref={sourceFileInputRef}
            aria-label="Task description images"
            type="file"
            className="sr-only"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={(event) => {
              uploadSourceFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </div>
        <Textarea
          ref={sourceTextareaRef}
          id="task-description"
          rows={12}
          value={markdown}
          placeholder="Problem context, scope, and expected output."
          className="min-h-64 resize-y rounded-none border-0 font-sans text-sm shadow-none focus-visible:ring-0"
          onChange={(event) => {
            setMode("markdown");
            onChange(event.currentTarget.value);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
          <Button
            type="button"
            size="sm"
            variant={
              effectiveMode === "visual" || effectiveMode === "loading" ? "secondary" : "ghost"
            }
            className="h-8 gap-1.5"
            onClick={enterVisualMode}
            disabled={checkingVisual}
          >
            <Eye className="size-3.5" /> Visual
          </Button>
          <Button
            type="button"
            size="sm"
            variant={effectiveMode === "markdown" ? "secondary" : "ghost"}
            className="h-8 gap-1.5"
            onClick={() => setMode("markdown")}
          >
            <Code2 className="size-3.5" /> Markdown
          </Button>
        </div>
        {hasPreservedFrontMatter ? (
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
            Front matter preserved · edit in Markdown mode
          </span>
        ) : null}
      </div>

      {effectiveGateMessage ? (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          role="alert"
          aria-label="Visual mode compatibility error"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{effectiveGateMessage}</span>
        </div>
      ) : null}

      {editorContent}

      {uploads.length > 0 ? (
        <ul className="space-y-1 text-xs" aria-label="Description image uploads">
          {uploads.map((upload) => (
            <li
              key={upload.id}
              className={upload.status === "error" ? "text-destructive" : "text-muted-foreground"}
              role={upload.status === "error" ? "alert" : "status"}
            >
              {upload.status === "uploading"
                ? `Uploading ${upload.fileName}…`
                : `${upload.fileName}: ${upload.error ?? "Upload failed."}`}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Visual mode supports common and extended Markdown. Rich edits can standardize source
        formatting; use Markdown mode for exact source control.
      </p>
    </div>
  );
}

export default function TaskDescriptionEditor(props: TaskDescriptionEditorProps): ReactElement {
  const identity = `${props.workspaceId ?? "no-workspace"}:${props.taskId ?? "new-task"}`;
  return <TaskDescriptionEditorSession key={identity} {...props} />;
}
