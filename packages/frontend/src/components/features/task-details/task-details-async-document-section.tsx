import { lazy, memo, type ReactElement, Suspense, useCallback } from "react";

import { TaskDetailsCollapsibleCard } from "./task-details-collapsible-card";
import type { TaskDocumentState } from "./use-task-documents";

const TaskDetailsMarkdownContent = lazy(async () => {
  const module = await import("./task-details-markdown-content");
  return { default: module.TaskDetailsMarkdownContent };
});

type TaskDetailsAsyncDocumentSectionProps = {
  title: string;
  icon: ReactElement;
  empty: string;
  document: TaskDocumentState;
  hasDocument: boolean;
  summaryUpdatedAt?: string | null;
  defaultExpanded?: boolean;
  onLoad: () => void;
};

export const TaskDetailsAsyncDocumentSection = memo(function TaskDetailsAsyncDocumentSection({
  title,
  icon,
  empty,
  document,
  hasDocument,
  summaryUpdatedAt = null,
  defaultExpanded = false,
  onLoad,
}: TaskDetailsAsyncDocumentSectionProps): ReactElement {
  const handleExpandedChange = useCallback(
    (expanded: boolean): void => {
      if (!expanded || !hasDocument) {
        return;
      }
      onLoad();
    },
    [hasDocument, onLoad],
  );

  return (
    <TaskDetailsCollapsibleCard
      title={title}
      icon={icon}
      updatedAt={document.updatedAt ?? summaryUpdatedAt}
      statusLabel={hasDocument ? null : "No document"}
      defaultExpanded={defaultExpanded}
      onExpandedChange={handleExpandedChange}
    >
      {({ isExpanded }) => {
        const markdownFallback = (
          <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
            <div className="h-3 w-2/5 animate-pulse rounded bg-card" />
            <div className="h-3 w-full animate-pulse rounded bg-card" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-card" />
          </div>
        );

        if (!hasDocument) {
          return (
            <p className="rounded-lg border border-dashed border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {empty}
            </p>
          );
        }

        if (document.error) {
          return (
            <p className="rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-muted">
              {document.error}
            </p>
          );
        }

        if (!document.loaded || document.isLoading) {
          return markdownFallback;
        }

        if (document.markdown.trim().length === 0) {
          return (
            <p className="rounded-lg border border-dashed border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {empty}
            </p>
          );
        }

        return (
          <Suspense fallback={markdownFallback}>
            <TaskDetailsMarkdownContent
              active={isExpanded}
              markdown={document.markdown}
              empty={empty}
              copyableMarkdown={document.markdown}
            />
          </Suspense>
        );
      }}
    </TaskDetailsCollapsibleCard>
  );
});
