import { Maximize2 } from "lucide-react";
import { lazy, memo, type ReactElement, Suspense, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { MarkdownPreviewModal } from "@/components/ui/markdown-preview-modal";

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
  /** Task ID used to enrich the fullscreen modal title. */
  taskId?: string;
};

export const TaskDetailsDocumentSection = memo(
  function TaskDetailsDocumentSection({
    title,
    icon,
    markdown,
    updatedAt,
    empty,
    defaultExpanded = false,
    taskId,
  }: TaskDetailsDocumentSectionProps): ReactElement {
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
        {hasContent ? (
          <TaskDetailsCollapsibleCard
            title={title}
            icon={icon}
            updatedAt={updatedAt}
            defaultExpanded={defaultExpanded}
            headerAction={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`Open ${title} in fullscreen`}
                data-testid={`expand-${title.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={openModal}
              >
                <Maximize2 className="size-3.5" />
              </Button>
            }
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
        ) : (
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
        )}
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
          />
        ) : null}
      </>
    );
  },
  (previous, next) =>
    previous.title === next.title &&
    previous.markdown === next.markdown &&
    previous.updatedAt === next.updatedAt &&
    previous.empty === next.empty &&
    previous.defaultExpanded === next.defaultExpanded &&
    previous.taskId === next.taskId,
);
