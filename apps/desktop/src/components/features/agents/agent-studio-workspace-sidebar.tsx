import type { ReactElement } from "react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

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

function DocumentSection({ emptyState, document }: DocumentSectionProps): ReactElement {
  return (
    <div className="p-4">
      {document.markdown.trim().length > 0 ? (
        <MarkdownRenderer
          markdown={document.markdown}
          variant="document"
          premiumCodeBlocks={hasLabeledCodeFence(document.markdown)}
        />
      ) : (
        <p className="text-sm text-slate-500">{emptyState}</p>
      )}
    </div>
  );
}

export function AgentStudioWorkspaceSidebar({
  model,
}: {
  model: AgentStudioWorkspaceSidebarModel;
}): ReactElement {
  if (!model.activeDocument) {
    return <div className="h-full min-h-0" />;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="space-y-1 border-b border-slate-200 p-4">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            {model.activeDocument.title}
          </h2>
          <p className="shrink-0 text-right text-xs text-slate-500">
            {formatDocumentUpdatedAt(model.activeDocument.document.updatedAt) ?? "Not set"}
          </p>
        </div>
        <p className="text-sm text-slate-500">{model.activeDocument.description}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DocumentSection
          emptyState={model.activeDocument.emptyState}
          document={model.activeDocument.document}
        />
      </div>
    </div>
  );
}
