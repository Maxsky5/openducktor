import { memo, type ReactElement, useCallback } from "react";

import { TaskDetailsCollapsibleCard } from "./task-details-collapsible-card";
import { TaskDetailsMarkdownContent } from "./task-details-markdown-content";
import type { TaskDocumentState } from "./use-task-documents";

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
        if (!hasDocument) {
          return <TaskDetailsMarkdownContent active={isExpanded} markdown="" empty={empty} />;
        }

        if (document.error) {
          return (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {document.error}
            </p>
          );
        }

        if (!document.loaded || document.isLoading) {
          return (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="h-3 w-2/5 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
            </div>
          );
        }

        return (
          <TaskDetailsMarkdownContent
            active={isExpanded}
            markdown={document.markdown}
            empty={empty}
          />
        );
      }}
    </TaskDetailsCollapsibleCard>
  );
});
