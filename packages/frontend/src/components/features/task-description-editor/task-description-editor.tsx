import type { TaskAssetStageResult } from "@openducktor/contracts";
import { AlertCircle, Code2, Eye, Info, LoaderCircle } from "lucide-react";
import { lazy, type ReactElement, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { splitTaskDescriptionFrontMatter } from "./task-description-front-matter";
import type { VisualMarkdownCompatibility } from "./task-description-markdown-compatibility";
import type { TaskDescriptionAssetUpload } from "./use-task-description-asset-draft";

const TaskDescriptionVisualEditor = lazy(() => import("./task-description-visual-editor"));

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
  }>({ markdown, result: null });
  const lastVisualChange = useRef<string | null>(null);
  const frontMatter = splitTaskDescriptionFrontMatter(markdown);

  useEffect(() => {
    if (lastVisualChange.current === markdown) {
      lastVisualChange.current = null;
      setCompatibilityState({ markdown, result: { compatible: true } });
      return;
    }
    let active = true;
    setCompatibilityState({ markdown, result: null });
    void import("./task-description-markdown")
      .then(({ assessVisualMarkdownCompatibility }) => {
        if (active) {
          setCompatibilityState({
            markdown,
            result: assessVisualMarkdownCompatibility(markdown),
          });
        }
      })
      .catch(() => {
        if (active) {
          setCompatibilityState({
            markdown,
            result: {
              compatible: false,
              reason:
                "Visual mode could not load its Markdown compatibility check. Keep editing in Markdown mode and retry after reloading the app.",
            },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [markdown]);

  let compatibility: VisualMarkdownCompatibility | null = null;
  if (lastVisualChange.current === markdown) {
    compatibility = { compatible: true };
  } else if (compatibilityState.markdown === markdown) {
    compatibility = compatibilityState.result;
  }
  const visualAllowed = compatibility?.compatible === true;
  const effectiveMode =
    (mode === "visual" || mode === "auto") && visualAllowed ? "visual" : "markdown";
  const effectiveGateMessage =
    compatibility && !compatibility.compatible ? compatibility.reason : null;

  const enterVisualMode = (): void => {
    if (!visualAllowed) {
      return;
    }
    setMode("visual");
  };

  const stageImage = async (file: File): Promise<TaskAssetStageResult> => {
    if (!workspaceId) {
      throw new Error("Select a workspace before adding task images.");
    }
    return onUpload(file);
  };

  const hasPreservedFrontMatter = frontMatter.kind === "valid";
  const visualBody = frontMatter.kind === "valid" ? frontMatter.body : markdown;
  const preservedPrefix = frontMatter.kind === "valid" ? frontMatter.raw : "";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
          <Button
            type="button"
            size="sm"
            variant={effectiveMode === "visual" ? "secondary" : "ghost"}
            className="h-8 gap-1.5"
            onClick={enterVisualMode}
            disabled={compatibility === null}
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
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{effectiveGateMessage}</span>
        </div>
      ) : null}

      {effectiveMode === "visual" ? (
        <Suspense
          fallback={
            <div className="flex min-h-64 items-center justify-center rounded-md border border-input bg-muted/20 text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading Visual editor…
            </div>
          }
        >
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
            renderContext={
              workspaceId && taskId ? { workspaceId, taskId, scope: "description" } : null
            }
          />
        </Suspense>
      ) : (
        <Textarea
          id="task-description"
          rows={12}
          value={markdown}
          placeholder="Problem context, scope, and expected output."
          className="min-h-64 resize-y font-mono text-sm"
          onChange={(event) => {
            setMode("markdown");
            onChange(event.currentTarget.value);
          }}
        />
      )}

      {compatibility === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          Checking whether Visual mode can preserve this Markdown…
        </p>
      ) : null}

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
