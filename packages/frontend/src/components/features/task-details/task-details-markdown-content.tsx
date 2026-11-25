import { ShortcutScope } from "@/features/shortcuts/shortcut-controls";
import { useLocalShortcuts } from "@/features/shortcuts/use-local-shortcuts";
import type { TaskAssetRenderContext } from "@openducktor/contracts";
import { type MouseEvent, memo, type ReactElement, useCallback, useRef } from "react";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { cn } from "@/lib/utils";
import {
  IssueMarkdownRenderer,
  type IssueImageContext,
} from "@/components/features/issue-source/issue-markdown-renderer";
import { buildCopyPreview } from "@/lib/copy-preview";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

type TaskDetailsMarkdownContentProps = {
  /** Markdown with content. The caller shows the empty state. */
  markdown: string;
  copyableMarkdown?: string;
  stripTaskDescriptionFrontMatter?: boolean;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  issueImageContext?: IssueImageContext;
};

export const TaskDetailsMarkdownContent = memo(function TaskDetailsMarkdownContent({
  markdown,
  copyableMarkdown,
  stripTaskDescriptionFrontMatter = false,
  taskAssetContext,
  issueImageContext,
}: TaskDetailsMarkdownContentProps): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: buildCopyPreview,
    errorLogContext: "TaskDetailsMarkdownContent",
  });

  const shortcutRoot = useRef<HTMLDivElement>(null);
  const copyContent = useCallback(() => {
    if (copyableMarkdown) void copyToClipboard(copyableMarkdown);
  }, [copyToClipboard, copyableMarkdown]);
  const shortcutOwner = useLocalShortcuts(
    shortcutRoot,
    [
      {
        id: "content-copy" as const,
        run: copyContent,
        disabledReason: copyableMarkdown ? null : "There is no description to copy.",
      },
    ],
    '[class~="group/card"]',
  );
  const handleCopy = useCallback(
    (e: MouseEvent<HTMLButtonElement>): void => {
      e.stopPropagation();
      e.preventDefault();
      copyContent();
    },
    [copyContent],
  );

  return (
    <ShortcutScope owners={[shortcutOwner]}>
      <div ref={shortcutRoot} className="relative">
        <div className={cn("max-h-84 overflow-y-auto", copyableMarkdown && "pr-9")}>
          <IssueMarkdownRenderer
            markdown={markdown}
            variant="document"
            stripTaskDescriptionFrontMatter={stripTaskDescriptionFrontMatter}
            {...(taskAssetContext ? { taskAssetContext } : {})}
            {...(issueImageContext ? { issueImageContext } : {})}
          />
        </div>
        {copyableMarkdown ? (
          <CopyIconButton
            shortcutId="content-copy"
            copied={copied}
            ariaLabel="Copy description content"
            dataTestId="copy-document-content"
            className="absolute top-2 right-2 z-10"
            onClick={handleCopy}
          />
        ) : null}
      </div>
    </ShortcutScope>
  );
});
