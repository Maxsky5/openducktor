import { memo, type ReactElement, startTransition, useEffect, useMemo, useState } from "react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

type TaskDetailsMarkdownContentProps = {
  markdown: string;
  empty: string;
  active: boolean;
};

const LARGE_MARKDOWN_DEFER_THRESHOLD = 2000;

export const TaskDetailsMarkdownContent = memo(function TaskDetailsMarkdownContent({
  markdown,
  empty,
  active,
}: TaskDetailsMarkdownContentProps): ReactElement {
  const hasContent = useMemo(() => /\S/.test(markdown), [markdown]);
  const hasLabeledCodeFence = useMemo(
    () => markdown.includes("```") && /```[a-z0-9_-]+/i.test(markdown),
    [markdown],
  );
  const shouldDeferMarkdown = hasContent && markdown.length >= LARGE_MARKDOWN_DEFER_THRESHOLD;
  const [isMarkdownReady, setIsMarkdownReady] = useState(() => !shouldDeferMarkdown);

  useEffect(() => {
    if (!hasContent) {
      setIsMarkdownReady(true);
      return;
    }

    if (!shouldDeferMarkdown) {
      setIsMarkdownReady(true);
      return;
    }

    if (!active || isMarkdownReady) {
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
  }, [active, hasContent, isMarkdownReady, shouldDeferMarkdown]);

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
          <p className="text-xs text-muted-foreground">Rendering markdown with syntax highlighting…</p>
        }
      />
    ),
    [hasLabeledCodeFence, markdown],
  );

  if (!hasContent) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }

  if (!isMarkdownReady) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
        <div className="h-3 w-4/5 animate-pulse rounded bg-secondary" />
        <div className="h-3 w-full animate-pulse rounded bg-secondary" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-secondary" />
      </div>
    );
  }

  return <div className="max-h-84 overflow-y-auto">{markdownNode}</div>;
});
