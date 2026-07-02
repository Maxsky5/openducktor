import type { ReactElement } from "react";
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

type AgentSessionTranscriptDialogProps = {
  workspaceRepoPath: string | null;
  target: AgentSessionTranscriptTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
};

type AgentSessionTranscriptDialogContentProps = {
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
  const resolvedTitle = resolveAgentSessionDialogTitle(title, model.thread.session?.title);

  return (
    <>
      <DialogHeader className="border-b border-border bg-card px-6 py-4">
        <DialogTitle>{resolvedTitle}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 bg-background">
        <AgentChatSurface model={model} />
      </div>
    </>
  );
}

export function AgentSessionTranscriptDialog({
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
