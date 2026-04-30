import { Maximize2 } from "lucide-react";
import { type MouseEvent, type ReactElement, useCallback, useState } from "react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { Button } from "@/components/ui/button";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { MarkdownPreviewModal } from "@/components/ui/markdown-preview-modal";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { buildCopyPreview } from "@/lib/copy-preview";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

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

const hasLabeledCodeFence = (markdown: string): boolean => {
  return markdown.includes("```") && /```[a-z0-9_-]+/i.test(markdown);
};

export type AgentStudioWorkspaceSidebarModel = {
  activeDocument: AgentStudioWorkspaceDocument | null;
};

type DocumentSectionProps = {
  emptyState: string;
  document: TaskDocumentState;
};

function AgentStudioDocumentCopyButton({ markdown }: { markdown: string }): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: buildCopyPreview,
    errorLogContext: "AgentStudioWorkspaceSidebar",
  });

  const handleCopy = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      void copyToClipboard(markdown);
    },
    [copyToClipboard, markdown],
  );

  return (
    <CopyIconButton
      copied={copied}
      ariaLabel="Copy document content"
      dataTestId="copy-agent-studio-document-content"
      className="absolute top-2 right-2 z-10"
      onClick={handleCopy}
    />
  );
}

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
          <AgentStudioDocumentCopyButton markdown={document.markdown} />
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

  if (!model.activeDocument) {
    return <div className="h-full min-h-0" />;
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
    </div>
  );
}
