import { Expand } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useState } from "react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { Button } from "@/components/ui/button";
import { DocumentCopyButton } from "@/components/ui/document-copy-button";
import { MarkdownPreviewModal } from "@/components/ui/markdown-preview-modal";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { hasLabeledCodeFence } from "@/lib/markdown-utils";

export type TaskExecutionDocument = {
  title: string;
  description: string;
  emptyState: string;
  document: TaskDocumentState;
};

const DOCUMENT_UPDATED_AT_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const formatDocumentUpdatedAt = (iso: string | null): string | null => {
  if (!iso) {
    return null;
  }
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return DOCUMENT_UPDATED_AT_FORMATTER.format(value);
};

export type TaskExecutionDocumentPanelModel = {
  activeDocument: TaskExecutionDocument | null;
};

type DocumentSectionProps = {
  emptyState: string;
  document: TaskDocumentState;
};

function DocumentSection({ emptyState, document }: DocumentSectionProps): ReactElement {
  let content: ReactElement;
  if (document.isLoading && !document.loaded) {
    content = <p className="text-sm text-muted-foreground">Loading document...</p>;
  } else if (document.error) {
    content = <p className="text-sm text-destructive">{document.error}</p>;
  } else if (document.markdown.trim().length > 0) {
    content = (
      <>
        <MarkdownRenderer
          markdown={document.markdown}
          variant="document"
          premiumCodeBlocks={hasLabeledCodeFence(document.markdown)}
        />
        <DocumentCopyButton
          markdown={document.markdown}
          dataTestId="copy-agent-studio-document-content"
          errorLogContext="TaskExecutionDocumentPanel"
          className="absolute top-2 right-2 z-10"
        />
      </>
    );
  } else {
    content = <p className="text-sm text-muted-foreground">{emptyState}</p>;
  }

  return <div className="relative p-4">{content}</div>;
}

export function TaskExecutionDocumentPanel({
  model,
}: {
  model: TaskExecutionDocumentPanelModel;
}): ReactElement {
  const [modalSnapshot, setModalSnapshot] = useState<{
    markdown: string;
    title: string;
  } | null>(null);

  const openModal = useCallback(() => {
    if (!model.activeDocument) {
      return;
    }
    setModalSnapshot({
      markdown: model.activeDocument.document.markdown,
      title: model.activeDocument.title,
    });
  }, [model.activeDocument]);

  const closeModal = useCallback(() => {
    setModalSnapshot(null);
  }, []);

  const snapshotModal = modalSnapshot ? (
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
  ) : null;

  if (!model.activeDocument) {
    return (
      <>
        <div className="h-full min-h-0" />
        {snapshotModal}
      </>
    );
  }

  const { activeDocument } = model;
  const canExpand = activeDocument.document.markdown.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            {activeDocument.title}
          </h2>
          {canExpand ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={`Open ${activeDocument.title} in fullscreen`}
              data-testid="expand-agent-studio-document"
              onClick={openModal}
            >
              <Expand className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{activeDocument.description}</p>
          <p className="shrink-0 text-right text-xs text-muted-foreground">
            {formatDocumentUpdatedAt(activeDocument.document.updatedAt) ?? "Not set"}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DocumentSection
          emptyState={activeDocument.emptyState}
          document={activeDocument.document}
        />
      </div>
      {snapshotModal}
    </div>
  );
}
