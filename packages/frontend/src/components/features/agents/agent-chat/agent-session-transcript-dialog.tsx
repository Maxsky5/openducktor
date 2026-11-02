import { useLayoutEffect, useMemo, useRef, type ReactElement } from "react";
import { useMinimumLoader } from "@openducktor/frontend-core/lib/use-minimum-loader";
import { DialogLoadingContext } from "@/components/ui/dialog-loading-context";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import type { UseTaskExecutionFilePreviewControllerResult } from "../file-preview/use-task-execution-file-preview-controller";
import { TaskExecutionSelectedFilePreview } from "../task-execution-file-preview";
import { ChatFileLinkProvider } from "./agent-chat-file-link-provider";
import { AgentChatSurface } from "./agent-chat";
import { resolveAgentSessionDialogTitle } from "./agent-session-dialog-title";
import type { AgentSessionTranscriptTarget } from "@openducktor/frontend-core/sessions/transcript/agent-session-transcript-target";
import { useSessionTranscriptSurfaceModel } from "./readonly-transcript/use-session-transcript-surface-model";

type AgentSessionTranscriptDialogProps = {
  preview: UseTaskExecutionFilePreviewControllerResult;
  workspaceRepoPath: string | null;
  target: AgentSessionTranscriptTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onFileSaved: (repoPath: string, taskId: string) => void;
};

type TranscriptContentProps = Omit<
  AgentSessionTranscriptDialogProps,
  "open" | "onOpenChange" | "target"
> & { target: AgentSessionTranscriptTarget };

export function AgentSessionTranscriptDialog({
  preview,
  workspaceRepoPath,
  target,
  open,
  onOpenChange,
  title,
  description,
  onFileSaved,
}: AgentSessionTranscriptDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(88vh,960px)] max-w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (!preview.model.selectedFile) return;
          event.preventDefault();
          preview.model.onClose();
        }}
      >
        {target ? (
          <TranscriptContent
            preview={preview}
            workspaceRepoPath={workspaceRepoPath}
            target={target}
            title={title}
            description={description}
            onFileSaved={onFileSaved}
          />
        ) : (
          <TranscriptHeader title={title} description={description} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TranscriptContent({
  preview,
  workspaceRepoPath,
  target,
  title,
  description,
  onFileSaved,
}: TranscriptContentProps): ReactElement {
  const { model, isPreparing } = useSessionTranscriptSurfaceModel({
    isOpen: true,
    workspaceRepoPath,
    target,
  });
  const loading = useMinimumLoader(isPreparing);
  const preparation = useMemo(() => ({ loading, label: "Loading transcript…" }), [loading]);
  const linkRef = useRef<HTMLElement | null>(null);
  const hasPreview = preview.model.selectedFile !== null;
  useLayoutEffect(() => {
    if (!hasPreview && linkRef.current?.isConnected) {
      linkRef.current.focus({ preventScroll: true });
      linkRef.current = null;
    }
  }, [hasPreview]);
  const resolvedTitle = resolveAgentSessionDialogTitle(
    title,
    model.thread.transcript.session?.title,
  );

  return (
    <>
      <TranscriptHeader title={resolvedTitle} description={description} />

      <DialogLoadingContext value={preparation}>
        <DialogBody className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div
              className="h-full min-h-0 bg-background"
              style={{ visibility: hasPreview ? "hidden" : undefined }}
              inert={hasPreview}
            >
              <ChatFileLinkProvider
                owner={{
                  workspaceId:
                    target.sessionScope?.kind === "workflow"
                      ? target.sessionScope.workspaceId
                      : null,
                  repoPath: workspaceRepoPath,
                  taskId:
                    target.sessionScope?.kind === "workflow" ? target.sessionScope.taskId : null,
                  workingDirectory: target.workingDirectory,
                  ownerKey: agentSessionIdentityKey(target),
                  onSelectFile: (file, trigger) => {
                    linkRef.current = trigger;
                    preview.onSelectFile(file);
                  },
                }}
              >
                <AgentChatSurface model={model} />
              </ChatFileLinkProvider>
            </div>
            {hasPreview ? (
              <DiffWorkerProvider>
                <div className="absolute inset-0 min-h-0 bg-background">
                  <TaskExecutionSelectedFilePreview
                    key={preview.model.previewSessionKey}
                    model={preview.model}
                    onFileSaved={() => {
                      if (workspaceRepoPath && target.sessionScope?.kind === "workflow")
                        onFileSaved(workspaceRepoPath, target.sessionScope.taskId);
                    }}
                  />
                </div>
              </DiffWorkerProvider>
            ) : null}
          </div>
        </DialogBody>
      </DialogLoadingContext>
    </>
  );
}

function TranscriptHeader({
  title,
  description,
}: Pick<TranscriptContentProps, "title" | "description">): ReactElement {
  return (
    <DialogHeader className="border-b border-border bg-card px-6 py-4">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
  );
}
