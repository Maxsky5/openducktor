import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { humanDate } from "@/lib/task-display";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { type ReactElement, memo, startTransition, useEffect, useMemo, useState } from "react";

type TaskDetailsDocumentSectionProps = {
  title: string;
  icon: ReactElement;
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  empty: string;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

const LARGE_MARKDOWN_DEFER_THRESHOLD = 2000;

export const TaskDetailsDocumentSection = memo(function TaskDetailsDocumentSection({
  title,
  icon,
  markdown,
  updatedAt,
  isLoading,
  error,
  empty,
  defaultExpanded = false,
  onExpandedChange,
}: TaskDetailsDocumentSectionProps): ReactElement {
  const hasContent = useMemo(() => /\S/.test(markdown), [markdown]);
  const hasLabeledCodeFence = useMemo(
    () => markdown.includes("```") && /```[a-z0-9_-]+/i.test(markdown),
    [markdown],
  );
  const shouldDeferMarkdown = hasContent && markdown.length >= LARGE_MARKDOWN_DEFER_THRESHOLD;
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isMarkdownReady, setIsMarkdownReady] = useState(() => !shouldDeferMarkdown);

  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  useEffect(() => {
    if (!hasContent) {
      setIsMarkdownReady(true);
      return;
    }

    if (!shouldDeferMarkdown) {
      setIsMarkdownReady(true);
      return;
    }

    if (!isExpanded || isMarkdownReady) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      startTransition(() => {
        setIsMarkdownReady(true);
      });
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [hasContent, isExpanded, isMarkdownReady, shouldDeferMarkdown]);

  useEffect(() => {
    setIsMarkdownReady(!shouldDeferMarkdown);
  }, [shouldDeferMarkdown]);

  const markdownNode = useMemo(
    () => (
      <MarkdownRenderer
        markdown={markdown}
        variant="document"
        premiumCodeBlocks={hasLabeledCodeFence}
        fallback={
          <p className="text-xs text-slate-500">Rendering markdown with syntax highlighting…</p>
        }
      />
    ),
    [hasLabeledCodeFence, markdown],
  );

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={(nextOpen) => {
        setIsExpanded(nextOpen);
        onExpandedChange?.(nextOpen);
      }}
      className="rounded-xl border border-slate-200/90 bg-white shadow-sm"
    >
      <div className="relative">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md p-4 text-left outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500/40"
          >
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {icon}
              {title}
            </h4>
            <span className="inline-flex items-center gap-2">
              {hasContent && updatedAt && isExpanded ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                  {humanDate(updatedAt)}
                </span>
              ) : null}
              <ChevronDown
                className={cn(
                  "size-3.5 text-slate-500 transition-transform duration-150",
                  isExpanded ? "rotate-180" : "rotate-0",
                )}
              />
            </span>
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent forceMount className="overflow-hidden data-[state=closed]:hidden px-4 pb-4">
        <div className="space-y-3 pt-3">
          {!isLoading && error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          {!error ? (
            hasContent ? (
              isMarkdownReady ? (
                <div className="max-h-84 overflow-y-auto">{markdownNode}</div>
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
                </div>
              )
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                {empty}
              </p>
            )
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
