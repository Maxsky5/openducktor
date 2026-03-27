import { Check, Copy } from "lucide-react";
import {
  type MouseEvent,
  memo,
  type ReactElement,
  startTransition,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

type TaskDetailsMarkdownContentProps = {
  markdown: string;
  empty: string;
  active: boolean;
  copyableMarkdown?: string;
  copyResetDelayMs?: number;
};

const LARGE_MARKDOWN_DEFER_THRESHOLD = 2000;
const LABELED_CODE_FENCE_PATTERN = /^[ \t]{0,3}(?:```|~~~)[ \t]*[^\s`~]/im;
const MARKDOWN_COPY_PREVIEW_LENGTH = 50;

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
  copyableMarkdown: string | undefined;
  copied: boolean;
  onCopy: (e: MouseEvent<HTMLButtonElement>) => void;
};

function DeferredTaskDetailsMarkdown({
  active,
  markdown,
  hasLabeledCodeFence,
  copyableMarkdown,
  copied,
  onCopy,
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
        <div className="h-3 w-4/5 animate-pulse rounded bg-border" />
        <div className="h-3 w-full animate-pulse rounded bg-border" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-border" />
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="max-h-84 overflow-y-auto">
        <TaskDetailsRenderedMarkdown
          markdown={markdown}
          hasLabeledCodeFence={hasLabeledCodeFence}
        />
      </div>
      {copyableMarkdown ? <TaskDetailsCopyButton copied={copied} onClick={onCopy} /> : null}
    </div>
  );
}

function TaskDetailsCopyButton({
  copied,
  onClick,
}: {
  copied: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute top-2 right-2 z-10 size-7 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Copy document content"
            data-testid="copy-document-content"
            onClick={onClick}
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-500 dark:text-emerald-400" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Copy</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function buildCopyPreview(markdown: string): string {
  if (markdown.length <= MARKDOWN_COPY_PREVIEW_LENGTH) {
    return markdown;
  }
  return `${markdown.slice(0, MARKDOWN_COPY_PREVIEW_LENGTH)}...`;
}

export const TaskDetailsMarkdownContent = memo(function TaskDetailsMarkdownContent({
  markdown,
  empty,
  active,
  copyableMarkdown,
  copyResetDelayMs,
}: TaskDetailsMarkdownContentProps): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: buildCopyPreview,
    ...(copyResetDelayMs === undefined ? {} : { resetDelayMs: copyResetDelayMs }),
    errorLogContext: "TaskDetailsMarkdownContent",
  });
  const hasContent = /\S/.test(markdown);
  const hasLabeledCodeFence = LABELED_CODE_FENCE_PATTERN.test(markdown);
  const shouldDeferMarkdown = hasContent && markdown.length >= LARGE_MARKDOWN_DEFER_THRESHOLD;

  const handleCopy = useCallback(
    (e: MouseEvent<HTMLButtonElement>): void => {
      e.stopPropagation();
      e.preventDefault();
      if (!copyableMarkdown) {
        return;
      }
      void copyToClipboard(copyableMarkdown);
    },
    [copyToClipboard, copyableMarkdown],
  );

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
        copyableMarkdown={copyableMarkdown}
        copied={copied}
        onCopy={handleCopy}
      />
    );
  }

  return (
    <div className="relative">
      <div className="max-h-84 overflow-y-auto">
        <TaskDetailsRenderedMarkdown
          markdown={markdown}
          hasLabeledCodeFence={hasLabeledCodeFence}
        />
      </div>
      {copyableMarkdown ? <TaskDetailsCopyButton copied={copied} onClick={handleCopy} /> : null}
    </div>
  );
});
