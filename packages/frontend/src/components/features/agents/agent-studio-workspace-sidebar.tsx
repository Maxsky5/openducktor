import { Maximize2 } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useState } from "react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { Button } from "@/components/ui/button";
import { DocumentCopyButton } from "@/components/ui/document-copy-button";
import { MarkdownPreviewModal } from "@/components/ui/markdown-preview-modal";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { hasLabeledCodeFence } from "@/lib/markdown-utils";

export type AgentStudioWorkspaceDocument = {
  title: string;
  description: string;
  emptyState: string;
  document: TaskDocumentState;
};

const formatDocumentUpdatedAt = (iso: string | null): string | null => {
  if (!iso) {
    return null;
  }
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
};

export type AgentStudioWorkspaceSidebarModel = {
  activeDocument: AgentStudioWorkspaceDocument | null;
};

type DocumentSectionProps = {
  emptyState: string;
  document: TaskDocumentState;
};

function DocumentSection({ emptyState, document }: DocumentSectionProps): ReactElement {
  return (
    <div className="relative p-4">
      {document.markdown.trim().length > 0 ? (
        <>
          <MarkdownRenderer
            markdown={document.markdown}
            variant="document"
            premiumCodeBlocks={hasLabeledCodeFence(document.markdown)}
          />
          <DocumentCopyButton
            markdown={document.markdown}
            dataTestId="copy-agent-studio-document-content"
            errorLogContext="AgentStudioWorkspaceSidebar"
            className="absolute top-2 right-2 z-10"
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyState}</p>
      )}
    </div>
  );
}

export function AgentStudioWorkspaceSidebar({
  model,
}: {
  model: AgentStudioWorkspaceSidebarModel;
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
      <div className="space-y-1 border-b border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
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
                <Maximize2 className="size-3.5" />
              </Button>
            ) : null}
          </div>
          <p className="shrink-0 text-right text-xs text-muted-foreground">
            {formatDocumentUpdatedAt(activeDocument.document.updatedAt) ?? "Not set"}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{activeDocument.description}</p>
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
