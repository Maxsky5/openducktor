import type { TaskAssetRenderContext } from "@openducktor/contracts";
import {
  type MouseEvent,
  memo,
  type ReactElement,
  startTransition,
  useCallback,
  useEffect,
  useReducer,
} from "react";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import {
  IssueMarkdownRenderer,
  type IssueImageContext,
} from "@/components/features/issue-source/issue-markdown-renderer";
import { buildCopyPreview } from "@/lib/copy-preview";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

type TaskDetailsMarkdownContentProps = {
  markdown: string;
  empty: string;
  active: boolean;
  copyableMarkdown?: string;
  stripTaskDescriptionFrontMatter?: boolean;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  issueImageContext?: IssueImageContext;
};

const LARGE_MARKDOWN_DEFER_THRESHOLD = 2000;
const LABELED_CODE_FENCE_PATTERN = /^[ \t]{0,3}(?:```|~~~)[ \t]*[^\s`~]/im;
type TaskDetailsRenderedMarkdownProps = {
  markdown: string;
  hasLabeledCodeFence: boolean;
  stripTaskDescriptionFrontMatter: boolean;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  issueImageContext?: IssueImageContext;
};

const TaskDetailsRenderedMarkdown = memo(function TaskDetailsRenderedMarkdown({
  markdown,
  hasLabeledCodeFence,
  stripTaskDescriptionFrontMatter,
  taskAssetContext,
  issueImageContext,
}: TaskDetailsRenderedMarkdownProps): ReactElement {
  return (
    <IssueMarkdownRenderer
      markdown={markdown}
      variant="document"
      premiumCodeBlocks={hasLabeledCodeFence}
      stripTaskDescriptionFrontMatter={stripTaskDescriptionFrontMatter}
      fallback={
        <p className="text-xs text-muted-foreground">
          Rendering markdown with syntax highlighting…
        </p>
      }
      {...(taskAssetContext ? { taskAssetContext } : {})}
      {...(issueImageContext ? { issueImageContext } : {})}
    />
  );
});

type DeferredTaskDetailsMarkdownProps = TaskDetailsRenderedMarkdownProps & {
  active: boolean;
  copyableMarkdown: string | undefined;
  copied: boolean;
  onCopy: (e: MouseEvent<HTMLButtonElement>) => void;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
};

function DeferredTaskDetailsMarkdown({
  active,
  markdown,
  hasLabeledCodeFence,
  stripTaskDescriptionFrontMatter,
  copyableMarkdown,
  copied,
  onCopy,
  taskAssetContext,
  issueImageContext,
}: DeferredTaskDetailsMarkdownProps): ReactElement {
  const [isMarkdownReady, setIsMarkdownReady] = useReducer(
    (_current: boolean, next: boolean) => next,
    false,
  );

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
          stripTaskDescriptionFrontMatter={stripTaskDescriptionFrontMatter}
          {...(taskAssetContext ? { taskAssetContext } : {})}
          {...(issueImageContext ? { issueImageContext } : {})}
        />
      </div>
      {copyableMarkdown ? (
        <CopyIconButton
          copied={copied}
          ariaLabel="Copy document content"
          dataTestId="copy-document-content"
          className="absolute top-2 right-2 z-10"
          onClick={onCopy}
        />
      ) : null}
    </div>
  );
}

export const TaskDetailsMarkdownContent = memo(function TaskDetailsMarkdownContent({
  markdown,
  empty,
  active,
  copyableMarkdown,
  stripTaskDescriptionFrontMatter = false,
  taskAssetContext,
  issueImageContext,
}: TaskDetailsMarkdownContentProps): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: buildCopyPreview,
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
        stripTaskDescriptionFrontMatter={stripTaskDescriptionFrontMatter}
        copyableMarkdown={copyableMarkdown}
        copied={copied}
        onCopy={handleCopy}
        {...(taskAssetContext ? { taskAssetContext } : {})}
        {...(issueImageContext ? { issueImageContext } : {})}
      />
    );
  }

  return (
    <div className="relative">
      <div className="max-h-84 overflow-y-auto">
        <TaskDetailsRenderedMarkdown
          markdown={markdown}
          hasLabeledCodeFence={hasLabeledCodeFence}
          stripTaskDescriptionFrontMatter={stripTaskDescriptionFrontMatter}
          {...(taskAssetContext ? { taskAssetContext } : {})}
          {...(issueImageContext ? { issueImageContext } : {})}
        />
      </div>
      {copyableMarkdown ? (
        <CopyIconButton
          copied={copied}
          ariaLabel="Copy document content"
          dataTestId="copy-document-content"
          className="absolute top-2 right-2 z-10"
          onClick={handleCopy}
        />
      ) : null}
    </div>
  );
});
