import { lazy, memo, type ReactElement, Suspense } from "react";

import { TaskDetailsCollapsibleCard } from "./task-details-collapsible-card";

const TaskDetailsMarkdownContent = lazy(async () => {
  const module = await import("./task-details-markdown-content");
  return { default: module.TaskDetailsMarkdownContent };
});

type TaskDetailsDocumentSectionProps = {
  title: string;
  icon: ReactElement;
  markdown: string;
  updatedAt: string | null;
  empty: string;
  defaultExpanded?: boolean;
};

export const TaskDetailsDocumentSection = memo(
  function TaskDetailsDocumentSection({
    title,
    icon,
    markdown,
    updatedAt,
    empty,
    defaultExpanded = false,
  }: TaskDetailsDocumentSectionProps): ReactElement {
    if (markdown.trim().length === 0) {
      return (
        <TaskDetailsCollapsibleCard
          title={title}
          icon={icon}
          updatedAt={updatedAt}
          defaultExpanded={defaultExpanded}
        >
          <p className="rounded-lg border border-dashed border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            {empty}
          </p>
        </TaskDetailsCollapsibleCard>
      );
    }

    return (
      <TaskDetailsCollapsibleCard
        title={title}
        icon={icon}
        updatedAt={updatedAt}
        defaultExpanded={defaultExpanded}
      >
        {({ isExpanded }) => (
          <Suspense
            fallback={
              <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
                <div className="h-3 w-4/5 animate-pulse rounded bg-card" />
                <div className="h-3 w-full animate-pulse rounded bg-card" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-card" />
              </div>
            }
          >
            <TaskDetailsMarkdownContent
              active={isExpanded}
              markdown={markdown}
              empty={empty}
              copyableMarkdown={markdown}
            />
          </Suspense>
        )}
      </TaskDetailsCollapsibleCard>
    );
  },
  (previous, next) =>
    previous.title === next.title &&
    previous.markdown === next.markdown &&
    previous.updatedAt === next.updatedAt &&
    previous.empty === next.empty &&
    previous.defaultExpanded === next.defaultExpanded &&
    previous.icon === next.icon,
);
