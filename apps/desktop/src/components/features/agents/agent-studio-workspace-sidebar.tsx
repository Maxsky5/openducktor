import { Check, Copy } from "lucide-react";
import { type MouseEvent, type ReactElement, useCallback } from "react";
import type { TaskDocumentState } from "@/components/features/task-details/use-task-documents";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

const DOCUMENT_COPY_PREVIEW_LENGTH = 50;

function buildCopyPreview(markdown: string): string {
  if (markdown.length <= DOCUMENT_COPY_PREVIEW_LENGTH) {
    return markdown;
  }
  return `${markdown.slice(0, DOCUMENT_COPY_PREVIEW_LENGTH)}...`;
}

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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute top-2 right-2 z-10 size-7 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Copy document content"
            data-testid="copy-agent-studio-document-content"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-500 dark:text-emerald-400" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Copy</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  if (!model.activeDocument) {
    return <div className="h-full min-h-0" />;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="space-y-1 border-b border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            {model.activeDocument.title}
          </h2>
          <p className="shrink-0 text-right text-xs text-muted-foreground">
            {formatDocumentUpdatedAt(model.activeDocument.document.updatedAt) ?? "Not set"}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{model.activeDocument.description}</p>
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
