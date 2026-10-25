import type { TaskAssetRenderContext } from "@openducktor/contracts";
import { Expand } from "lucide-react";
import { lazy, memo, type ReactElement, Suspense, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { MarkdownPreviewModal } from "@/components/ui/markdown-preview-modal";
import {
  type IssueImageContext,
  useIssueImageComponents,
} from "@/components/features/issue-source/issue-markdown-renderer";

import { CollapsibleCard, CollapsibleCardEmpty } from "@/components/ui/collapsible-card";

const TaskDetailsMarkdownContent = lazy(async () => {
  const module = await import("./task-details-markdown-content");
  return { default: module.TaskDetailsMarkdownContent };
});

const MARKDOWN_SKELETON = (
  <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
    <div className="h-3 w-4/5 animate-pulse rounded bg-card" />
    <div className="h-3 w-full animate-pulse rounded bg-card" />
    <div className="h-3 w-3/4 animate-pulse rounded bg-card" />
  </div>
);

type TaskDetailsDocumentSectionProps = {
  title: string;
  icon: ReactElement;
  markdown: string;
  empty: string;
  defaultExpanded?: boolean;
  /** Task ID used to enrich the fullscreen modal title. */
  taskId?: string;
  stripTaskDescriptionFrontMatter?: boolean;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  issueImageContext?: IssueImageContext;
};

export const TaskDetailsDocumentSection = memo(
  function TaskDetailsDocumentSection({
    title,
    icon,
    markdown,
    empty,
    defaultExpanded = false,
    taskId,
    stripTaskDescriptionFrontMatter = false,
    taskAssetContext,
    issueImageContext,
  }: TaskDetailsDocumentSectionProps): ReactElement {
    const issueImageComponents = useIssueImageComponents(issueImageContext);
    const [modalSnapshot, setModalSnapshot] = useState<{
      markdown: string;
      title: string;
    } | null>(null);

    const openModal = useCallback(() => {
      const modalTitle = taskId ? `${taskId} - ${title}` : title;
      setModalSnapshot({ markdown, title: modalTitle });
    }, [markdown, title, taskId]);

    const closeModal = useCallback(() => {
      setModalSnapshot(null);
    }, []);

    const hasContent = markdown.trim().length > 0;

    return (
      <>
        <CollapsibleCard
          title={title}
          icon={icon}
          defaultExpanded={defaultExpanded}
          headerAction={
            hasContent ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`Open ${title} in fullscreen`}
                data-testid={`expand-${title.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={openModal}
              >
                <Expand className="size-3.5" />
              </Button>
            ) : null
          }
        >
          {hasContent ? (
            <Suspense fallback={MARKDOWN_SKELETON}>
              <TaskDetailsMarkdownContent
                markdown={markdown}
                copyableMarkdown={markdown}
                stripTaskDescriptionFrontMatter={stripTaskDescriptionFrontMatter}
                {...(taskAssetContext ? { taskAssetContext } : {})}
                {...(issueImageContext ? { issueImageContext } : {})}
              />
            </Suspense>
          ) : (
            <CollapsibleCardEmpty>{empty}</CollapsibleCardEmpty>
          )}
        </CollapsibleCard>
        {modalSnapshot ? (
          <MarkdownPreviewModal
            open
            onOpenChange={(nextOpen) => {
              if (!nextOpen) {
                closeModal();
              }
            }}
            markdown={modalSnapshot.markdown}
            title={modalSnapshot.title}
            stripTaskDescriptionFrontMatter={stripTaskDescriptionFrontMatter}
            {...(taskAssetContext ? { taskAssetContext } : {})}
            {...(issueImageComponents ? { components: issueImageComponents } : {})}
          />
        ) : null}
      </>
    );
  },
  (previous, next) =>
    previous.title === next.title &&
    previous.markdown === next.markdown &&
    previous.empty === next.empty &&
    previous.defaultExpanded === next.defaultExpanded &&
    previous.taskId === next.taskId &&
    previous.stripTaskDescriptionFrontMatter === next.stripTaskDescriptionFrontMatter &&
    previous.taskAssetContext?.workspaceId === next.taskAssetContext?.workspaceId &&
    previous.taskAssetContext?.taskId === next.taskAssetContext?.taskId &&
    previous.taskAssetContext?.scope === next.taskAssetContext?.scope &&
    previous.issueImageContext?.repoPath === next.issueImageContext?.repoPath &&
    previous.issueImageContext?.sourceId === next.issueImageContext?.sourceId &&
    previous.issueImageContext?.providerId === next.issueImageContext?.providerId,
);
