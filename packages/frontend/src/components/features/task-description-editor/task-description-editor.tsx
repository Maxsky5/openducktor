import type { TaskAssetStageResult } from "@openducktor/contracts";
import { AlertCircle, Code2, Eye, Info } from "lucide-react";
import { lazy, type ReactElement, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { IssueImageContext } from "@/components/features/issue-source/github-issue-image";
import type { MermaidPreviews } from "@/components/ui/markdown-mermaid-state";
import { TaskDescriptionEditorLoading } from "./task-description-editor-loading";
import { splitTaskDescriptionFrontMatter } from "./task-description-front-matter";
import { TaskDescriptionMarkdownSource } from "./task-description-markdown-source";
import type { VisualMarkdownCompatibility } from "./task-description-markdown-compatibility";
import type { TaskDescriptionAssetUpload } from "./use-task-description-asset-draft";

const loadTaskDescriptionMarkdown = () => import("./task-description-markdown");
const loadTaskDescriptionVisualEditor = () => import("./task-description-visual-editor");
const TaskDescriptionVisualEditor = lazy(loadTaskDescriptionVisualEditor);

type TaskDescriptionEditorProps = {
  markdown: string;
  workspaceId: string | null;
  taskId: string | null;
  issueImageContext?: IssueImageContext | undefined;
  onChange(markdown: string): void;
  onUpload(file: File): Promise<TaskAssetStageResult>;
  uploads: TaskDescriptionAssetUpload[];
  previews: ReadonlyMap<string, string>;
};

function useVisualMarkdownCompatibility(markdown: string, mode: "auto" | "visual" | "markdown") {
  const [state, setState] = useState<{
    markdown: string;
    result: VisualMarkdownCompatibility | null;
    mermaidPreviews: MermaidPreviews;
  }>({ markdown, result: null, mermaidPreviews: new Map() });
  const lastVisualChange = useRef<string | null>(null);
  const isCurrent = state.markdown === markdown && state.result !== null;

  useEffect(() => {
    if (lastVisualChange.current === markdown) {
      lastVisualChange.current = null;
      setState({ markdown, result: { compatible: true }, mermaidPreviews: new Map() });
      return;
    }
    if (mode === "markdown" || isCurrent) return;
    let active = true;
    setState({ markdown, result: null, mermaidPreviews: new Map() });
    void (async () => {
      try {
        const [{ assessVisualMarkdownCompatibility }] = await Promise.all([
          loadTaskDescriptionMarkdown(),
          loadTaskDescriptionVisualEditor(),
        ]);
        const result = assessVisualMarkdownCompatibility(markdown);
        if (active) setState({ markdown, result, mermaidPreviews: new Map() });
      } catch {
        if (active) {
          setState({
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
  }, [isCurrent, markdown, mode]);

  const compatibility: VisualMarkdownCompatibility | null =
    lastVisualChange.current === markdown
      ? { compatible: true }
      : state.markdown === markdown
        ? state.result
        : null;
  return {
    compatibility,
    mermaidPreviews: state.mermaidPreviews,
    isCurrent: state.markdown === markdown,
    markVisualChange: (value: string) => {
      lastVisualChange.current = value;
    },
  };
}

function descriptionEditorMode(
  mode: "auto" | "visual" | "markdown",
  compatibility: VisualMarkdownCompatibility | null,
): "loading" | "markdown" | "visual" {
  if (mode === "markdown") return "markdown";
  if (compatibility === null) return "loading";
  return compatibility.compatible ? "visual" : "markdown";
}

function TaskDescriptionEditorSession({
  markdown,
  workspaceId,
  taskId,
  issueImageContext,
  onChange,
  onUpload,
  uploads,
  previews,
}: TaskDescriptionEditorProps): ReactElement {
  const [mode, setMode] = useState<"auto" | "visual" | "markdown">("auto");
  const { compatibility, mermaidPreviews, isCurrent, markVisualChange } =
    useVisualMarkdownCompatibility(markdown, mode);
  const frontMatter = splitTaskDescriptionFrontMatter(markdown);
  const renderContext = useMemo(
    () => (workspaceId && taskId ? { workspaceId, taskId, scope: "description" as const } : null),
    [taskId, workspaceId],
  );

  const visualAllowed = compatibility?.compatible === true;
  const effectiveMode = descriptionEditorMode(mode, compatibility);
  const checkingVisual = effectiveMode === "loading";
  const effectiveGateMessage =
    compatibility && !compatibility.compatible ? compatibility.reason : null;

  const enterVisualMode = (): void => {
    if (visualAllowed) {
      setMode("visual");
      return;
    }
    if (!isCurrent) {
      setMode("auto");
    }
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
            markVisualChange(nextMarkdown);
            onChange(nextMarkdown);
          }}
          onUpload={stageImage}
          uploads={uploads}
          previews={previews}
          mermaidPreviews={mermaidPreviews}
          renderContext={renderContext}
          issueImageContext={issueImageContext}
        />
      </Suspense>
    );
  } else {
    editorContent = (
      <TaskDescriptionMarkdownSource
        markdown={markdown}
        onChange={onChange}
        onUpload={stageImage}
        onEdit={() => setMode("markdown")}
        uploads={uploads}
      />
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
