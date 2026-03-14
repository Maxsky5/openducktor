import { memo, type ReactElement, startTransition, useEffect, useState } from "react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

type TaskDetailsMarkdownContentProps = {
  markdown: string;
  empty: string;
  active: boolean;
};

const LARGE_MARKDOWN_DEFER_THRESHOLD = 2000;

type TaskDetailsRenderedMarkdownProps = {
  markdown: string;
  hasLabeledCodeFence: boolean;
};

function TaskDetailsRenderedMarkdown({
  markdown,
  hasLabeledCodeFence,
}: TaskDetailsRenderedMarkdownProps): ReactElement {
  return (
    <MarkdownRenderer
      markdown={markdown}
      variant="document"
      premiumCodeBlocks={hasLabeledCodeFence}
      fallback={
        <p className="text-xs text-muted-foreground">
          Rendering markdown with syntax highlighting…
        </p>
      }
    />
  );
}

type DeferredTaskDetailsMarkdownProps = TaskDetailsRenderedMarkdownProps & {
  active: boolean;
};

function DeferredTaskDetailsMarkdown({
  active,
  markdown,
  hasLabeledCodeFence,
}: DeferredTaskDetailsMarkdownProps): ReactElement {
  const [isMarkdownReady, setIsMarkdownReady] = useState(false);

  useEffect(() => {
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
  }, [active, isMarkdownReady]);

  if (!isMarkdownReady) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
        <div className="h-3 w-4/5 animate-pulse rounded bg-secondary" />
        <div className="h-3 w-full animate-pulse rounded bg-secondary" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-secondary" />
      </div>
    );
  }

  return (
    <div className="max-h-84 overflow-y-auto">
      <TaskDetailsRenderedMarkdown markdown={markdown} hasLabeledCodeFence={hasLabeledCodeFence} />
    </div>
  );
}

export const TaskDetailsMarkdownContent = memo(function TaskDetailsMarkdownContent({
  markdown,
  empty,
  active,
}: TaskDetailsMarkdownContentProps): ReactElement {
  const hasContent = /\S/.test(markdown);
  const hasLabeledCodeFence = markdown.includes("```") && /```[a-z0-9_-]+/i.test(markdown);
  const shouldDeferMarkdown = hasContent && markdown.length >= LARGE_MARKDOWN_DEFER_THRESHOLD;

  if (!hasContent) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }

  if (shouldDeferMarkdown) {
    return (
      <DeferredTaskDetailsMarkdown
        key={markdown}
        active={active}
        markdown={markdown}
        hasLabeledCodeFence={hasLabeledCodeFence}
      />
    );
  }

  return (
    <div className="max-h-84 overflow-y-auto">
      <TaskDetailsRenderedMarkdown markdown={markdown} hasLabeledCodeFence={hasLabeledCodeFence} />
    </div>
  );
});
