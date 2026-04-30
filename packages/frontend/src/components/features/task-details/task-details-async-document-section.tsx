import { Expand } from "lucide-react";
import { lazy, memo, type ReactElement, Suspense, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { MarkdownPreviewModal } from "@/components/ui/markdown-preview-modal";

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
  /** Task ID used to enrich the fullscreen modal title. */
  taskId?: string;
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
  taskId,
}: TaskDetailsAsyncDocumentSectionProps): ReactElement {
  const [modalSnapshot, setModalSnapshot] = useState<{
    markdown: string;
    title: string;
  } | null>(null);

  const handleExpandedChange = useCallback(
    (expanded: boolean): void => {
      if (!expanded || !hasDocument) {
        return;
      }
      onLoad();
    },
    [hasDocument, onLoad],
  );

  const openModal = useCallback(() => {
    const modalTitle = taskId ? `${taskId} - ${title}` : title;
    setModalSnapshot({ markdown: document.markdown, title: modalTitle });
  }, [document.markdown, title, taskId]);

  const closeModal = useCallback(() => {
    setModalSnapshot(null);
  }, []);

  const canExpand =
    hasDocument &&
    !document.error &&
    document.loaded &&
    !document.isLoading &&
    document.markdown.trim().length > 0;

  const markdownFallback = (
    <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
      <div className="h-3 w-2/5 animate-pulse rounded bg-card" />
      <div className="h-3 w-full animate-pulse rounded bg-card" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-card" />
    </div>
  );

  const children = ({ isExpanded }: { isExpanded: boolean }) => {
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
  };

  const commonProps = {
    title,
    icon,
    updatedAt: document.updatedAt ?? summaryUpdatedAt,
    statusLabel: hasDocument ? null : ("No document" as const),
    defaultExpanded,
    onExpandedChange: handleExpandedChange,
    children,
  };

  return (
    <>
      {canExpand ? (
        <TaskDetailsCollapsibleCard
          {...commonProps}
          headerAction={
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
          }
        />
      ) : (
        <TaskDetailsCollapsibleCard {...commonProps} />
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
});
