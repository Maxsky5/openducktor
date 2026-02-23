import type { ReactElement } from "react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="p-3">
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
    <div className="flex h-full min-h-0">
      <Card className="flex h-full min-h-0 w-full flex-col overflow-hidden border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <CardTitle className="text-lg">{model.activeDocument.title}</CardTitle>
            <p className="shrink-0 text-right text-xs text-slate-500">
              {formatDocumentUpdatedAt(model.activeDocument.document.updatedAt) ?? "Not set"}
            </p>
          </div>
          <CardDescription>{model.activeDocument.description}</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto">
          <DocumentSection
            emptyState={model.activeDocument.emptyState}
            document={model.activeDocument.document}
          />
        </CardContent>
      </Card>
    </div>
  );
}
