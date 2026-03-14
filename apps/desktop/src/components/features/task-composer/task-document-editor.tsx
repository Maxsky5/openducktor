import { Eye, FilePenLine, LayoutPanelLeft } from "lucide-react";
import { type ReactElement, type ReactNode, useDeferredValue } from "react";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Textarea } from "@/components/ui/textarea";
import { humanDate } from "@/lib/task-display";
import { cn } from "@/lib/utils";
import type { DocumentEditorView } from "@/types/task-composer";

type TaskDocumentEditorProps = {
  title: string;
  subtitle: string;
  placeholder: string;
  markdown: string;
  view: DocumentEditorView;
  onViewChange: (view: DocumentEditorView) => void;
  updatedAt: string | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  hasUnsavedChanges: boolean;
  onMarkdownChange: (value: string) => void;
  onRetryLoad: () => void;
};

const VIEW_OPTIONS: Array<{
  id: DocumentEditorView;
  label: string;
  icon: typeof FilePenLine;
}> = [
  { id: "write", label: "Write", icon: FilePenLine },
  { id: "split", label: "Split", icon: LayoutPanelLeft },
  { id: "preview", label: "Preview", icon: Eye },
];

const hasLabeledCodeFence = (value: string): boolean =>
  value.includes("```") && /```[a-z0-9_-]+/i.test(value);

const PANEL_MIN_HEIGHT_CLASS = "min-h-[52vh]";
const PANEL_SCROLL_VIEWPORT_CLASS = "max-h-[52vh] overflow-y-auto";

type PaneProps = {
  label: string;
  hiddenOnMobile?: boolean;
  children: ReactNode;
};

function Pane({ label, hiddenOnMobile = false, children }: PaneProps): ReactElement {
  return (
    <div className={cn("space-y-2", hiddenOnMobile ? "max-md:hidden" : "")}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function LoadingPaneSkeleton({ kind }: { kind: "editor" | "preview" }): ReactElement {
  const widths = kind === "editor" ? ["w-2/5", "w-full", "w-5/6"] : ["w-1/3", "w-full", "w-4/5"];

  return (
    <div
      className={cn(
        PANEL_MIN_HEIGHT_CLASS,
        "space-y-3 rounded-md border border-border bg-muted p-3",
      )}
    >
      {widths.map((width) => (
        <div key={width} className={cn("h-3 animate-pulse rounded bg-secondary", width)} />
      ))}
    </div>
  );
}

export function TaskDocumentEditor({
  title,
  subtitle,
  placeholder,
  markdown,
  view,
  onViewChange,
  updatedAt,
  isLoading,
  isSaving,
  error,
  hasUnsavedChanges,
  onMarkdownChange,
  onRetryLoad,
}: TaskDocumentEditorProps): ReactElement {
  const deferredMarkdown = useDeferredValue(markdown);
  const lineCount = markdown.trim().length === 0 ? 0 : markdown.split(/\r?\n/).length;
  const showEditor = view !== "preview";
  const showPreview = view !== "write";
  const showMobileSplitHint = view === "split";
  const shouldShowLoadingSkeleton = isLoading && !hasUnsavedChanges && markdown.trim().length === 0;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-muted/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = option.id === view;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  onClick={() => onViewChange(option.id)}
                  aria-pressed={isActive}
                >
                  <Icon className="size-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{lineCount.toLocaleString()} lines</span>
          <span>Last saved: {updatedAt ? humanDate(updatedAt) : "Not saved yet"}</span>
          {hasUnsavedChanges ? (
            <span className="font-medium text-warning-muted">Unsaved changes</span>
          ) : (
            <span>All changes saved</span>
          )}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2">
          <p className="text-sm text-destructive-muted">{error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetryLoad}>
            Retry
          </Button>
        </div>
      ) : null}

      {shouldShowLoadingSkeleton ? (
        <div className={cn("grid gap-3", view === "split" ? "md:grid-cols-2" : "grid-cols-1")}>
          {showEditor ? (
            <Pane label="Markdown">
              <LoadingPaneSkeleton kind="editor" />
            </Pane>
          ) : null}

          {showPreview ? (
            <Pane label="Preview" hiddenOnMobile={view === "split"}>
              <LoadingPaneSkeleton kind="preview" />
            </Pane>
          ) : null}
        </div>
      ) : (
        <div className={cn("grid gap-3", view === "split" ? "md:grid-cols-2" : "grid-cols-1")}>
          {showEditor ? (
            <Pane label="Markdown">
              <Textarea
                value={markdown}
                onChange={(event) => onMarkdownChange(event.currentTarget.value)}
                placeholder={placeholder}
                className={cn(PANEL_MIN_HEIGHT_CLASS, "resize-y font-mono text-[13px] leading-6")}
                disabled={isSaving || isLoading}
              />
            </Pane>
          ) : null}

          {showPreview ? (
            <Pane label="Preview" hiddenOnMobile={view === "split"}>
              <div
                className={cn(
                  PANEL_MIN_HEIGHT_CLASS,
                  PANEL_SCROLL_VIEWPORT_CLASS,
                  "rounded-md border border-border bg-card p-3",
                )}
              >
                {deferredMarkdown.trim().length > 0 ? (
                  <MarkdownRenderer
                    markdown={deferredMarkdown}
                    variant="document"
                    premiumCodeBlocks={hasLabeledCodeFence(deferredMarkdown)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
                )}
              </div>
            </Pane>
          ) : null}
        </div>
      )}

      {showMobileSplitHint ? (
        <p className="text-xs text-muted-foreground md:hidden">
          Split preview is available side-by-side on wider screens.
        </p>
      ) : null}
    </div>
  );
}
