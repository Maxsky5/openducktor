import { ChevronDown, Expand } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useState } from "react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DocumentCopyButton } from "@/components/ui/document-copy-button";
import { MarkdownPreviewModal } from "@/components/ui/markdown-preview-modal";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { hasLabeledCodeFence } from "@/lib/markdown-utils";

export type TaskExecutionDocument = {
  title: string;
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

export type TaskDocumentKind = "spec" | "plan" | "qa";

const TASK_DOCUMENT_KINDS = ["spec", "plan", "qa"] as const satisfies readonly TaskDocumentKind[];

export type TaskExecutionDocuments = { [Kind in TaskDocumentKind]: TaskExecutionDocument };

export type TaskExecutionDocumentPanelModel = {
  documents: TaskExecutionDocuments;
  selectedKind: TaskDocumentKind;
  onSelectKind: (kind: TaskDocumentKind) => void;
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

  const activeDocument = model.documents[model.selectedKind];
  const openModal = useCallback(() => {
    setModalSnapshot({
      markdown: activeDocument.document.markdown,
      title: activeDocument.title,
    });
  }, [activeDocument]);

  const closeModal = useCallback(() => {
    setModalSnapshot(null);
  }, []);

  const canExpand = activeDocument.document.markdown.trim().length > 0;

  const documentOptions = TASK_DOCUMENT_KINDS.map((kind): ComboboxOption => ({
    value: kind,
    label: model.documents[kind].title,
    secondaryLabel: formatDocumentUpdatedAt(model.documents[kind].document.updatedAt) ?? "Not set",
  }));

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border py-2 pr-3 pl-2">
        <Combobox
          value={model.selectedKind}
          onValueChange={(value) => {
            const kind = TASK_DOCUMENT_KINDS.find((candidate) => candidate === value);
            if (kind) model.onSelectKind(kind);
          }}
          options={documentOptions}
          searchable={false}
          className="w-64"
          trigger={
            <Button
              type="button"
              variant="ghost"
              aria-label={`${activeDocument.title}, change document`}
              className="h-8 min-w-0 gap-1.5 px-2 text-base font-semibold tracking-tight"
            >
              <span className="truncate">{activeDocument.title}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Button>
          }
        />
        <div className="flex shrink-0 items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {formatDocumentUpdatedAt(activeDocument.document.updatedAt) ?? "Not set"}
          </p>
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
