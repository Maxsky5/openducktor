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
    const [modalOpen, setModalOpen] = useState(false);

    const openModal = useCallback(() => {
      setModalOpen(true);
    }, []);

    const hasContent = markdown.trim().length > 0;

    if (!hasContent) {
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

    const expandButton = (
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
    );

    return (
      <>
        <TaskDetailsCollapsibleCard
          title={title}
          icon={icon}
          updatedAt={updatedAt}
          defaultExpanded={defaultExpanded}
          headerAction={expandButton}
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
        <MarkdownPreviewModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          markdown={markdown}
          title={title}
        />
      </>
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
