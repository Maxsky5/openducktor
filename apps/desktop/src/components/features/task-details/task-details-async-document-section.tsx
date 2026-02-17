import { type ReactElement, memo, useCallback } from "react";

import { TaskDetailsCollapsibleCard } from "./task-details-collapsible-card";
import { TaskDetailsMarkdownContent } from "./task-details-markdown-content";
import type { TaskDocumentState } from "./use-task-documents";

type TaskDetailsAsyncDocumentSectionProps = {
  title: string;
  icon: ReactElement;
  empty: string;
  document: TaskDocumentState;
  defaultExpanded?: boolean;
  onLoad: () => void;
};

export const TaskDetailsAsyncDocumentSection = memo(function TaskDetailsAsyncDocumentSection({
  title,
  icon,
  empty,
  document,
  defaultExpanded = false,
  onLoad,
}: TaskDetailsAsyncDocumentSectionProps): ReactElement {
  const handleExpandedChange = useCallback(
    (expanded: boolean): void => {
      if (!expanded) {
        return;
      }
      onLoad();
    },
    [onLoad],
  );

  return (
    <TaskDetailsCollapsibleCard
      title={title}
      icon={icon}
      updatedAt={document.updatedAt}
      defaultExpanded={defaultExpanded}
      onExpandedChange={handleExpandedChange}
    >
      {({ isExpanded }) => {
        if (!isExpanded) {
          return null;
        }

        if (document.error) {
          return (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {document.error}
            </p>
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
