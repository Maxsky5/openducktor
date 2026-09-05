import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { UseTaskExecutionFilePreviewControllerResult } from "../file-preview/use-task-execution-file-preview-controller";
import { TaskExecutionSelectedFilePreview } from "../task-execution-file-preview";
import { ChatFileLinkProvider } from "./agent-chat-file-link-context";
import { useLayoutEffect, useRef, type ReactElement } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentChatSurface } from "./agent-chat";
import { resolveAgentSessionDialogTitle } from "./agent-session-dialog-title";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";
import { useSessionTranscriptSurfaceModel } from "./readonly-transcript/use-session-transcript-surface-model";

const onDialogFileSaved = (): void => {};

type AgentSessionTranscriptDialogProps = {
  preview: UseTaskExecutionFilePreviewControllerResult;
  workspaceRepoPath: string | null;
  target: AgentSessionTranscriptTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
};

type AgentSessionTranscriptDialogContentProps = {
  preview: UseTaskExecutionFilePreviewControllerResult;
  workspaceRepoPath: string | null;
  target: AgentSessionTranscriptTarget;
  title: string;
  description: string;
};

function AgentSessionTranscriptDialogLoading({
  title,
  description,
}: Pick<AgentSessionTranscriptDialogContentProps, "title" | "description">): ReactElement {
  return (
    <>
      <DialogHeader className="border-b border-border bg-card px-6 py-4">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
        <output className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
          Opening conversation…
        </output>
      </div>
    </>
  );
}

function AgentSessionTranscriptDialogContent({
  preview,
  workspaceRepoPath,
  target,
  title,
  description,
}: AgentSessionTranscriptDialogContentProps): ReactElement {
  const { model } = useSessionTranscriptSurfaceModel({
    isOpen: true,
    workspaceRepoPath,
    target,
  });
  const chatRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLElement | null>(null);
  const hasPreview = preview.model.selectedFile !== null;
  useLayoutEffect(() => {
    if (!hasPreview && linkRef.current?.isConnected) linkRef.current.focus();
  }, [hasPreview]);
  const resolvedTitle = resolveAgentSessionDialogTitle(
    title,
    model.thread.transcript.session?.title,
  );

  return (
    <>
      <DialogHeader className="border-b border-border bg-card px-6 py-4">
        <DialogTitle>{resolvedTitle}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="relative min-h-0 flex-1">
        <div
          className="h-full min-h-0 bg-background"
          style={{ visibility: hasPreview ? "hidden" : undefined }}
          inert={hasPreview}
          ref={chatRef}
        >
          <ChatFileLinkProvider
            owner={{
              repoPath: workspaceRepoPath,
              taskId: target.sessionScope?.kind === "workflow" ? target.sessionScope.taskId : null,
              ownerKey: agentSessionIdentityKey(target),
              onSelectFile: (file) => {
                if (
                  document.activeElement instanceof HTMLElement &&
                  chatRef.current?.contains(document.activeElement)
                )
                  linkRef.current = document.activeElement;
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
                onFileSaved={onDialogFileSaved}
              />
            </div>
          </DiffWorkerProvider>
        ) : null}
      </div>
    </>
  );
}

export function AgentSessionTranscriptDialog({
  preview,
  workspaceRepoPath,
  target,
  open,
  onOpenChange,
  title,
  description,
}: AgentSessionTranscriptDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,960px)] max-w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0">
        {target ? (
          <AgentSessionTranscriptDialogContent
            preview={preview}
            workspaceRepoPath={workspaceRepoPath}
            target={target}
            title={title}
            description={description}
          />
        ) : (
          <AgentSessionTranscriptDialogLoading title={title} description={description} />
        )}
      </DialogContent>
    </Dialog>
  );
}
