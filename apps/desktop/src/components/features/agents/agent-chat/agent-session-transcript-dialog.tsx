import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { ReactElement } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActiveWorkspace } from "@/types/state-slices";
import { AgentChatSurface } from "./agent-chat";
import { resolveAgentSessionDialogTitle } from "./agent-session-dialog-title";
import { useReadonlySessionTranscriptSurfaceModel } from "./use-readonly-session-transcript-surface-model";

type AgentSessionTranscriptDialogProps = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  sessionId: string | null;
  persistedRecords?: AgentSessionRecord[];
  fallbackSession?: {
    role: AgentRole;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
  };
  isResolvingRequestedSession: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
};

export function AgentSessionTranscriptDialog({
  activeWorkspace,
  taskId,
  sessionId,
  persistedRecords,
  fallbackSession,
  isResolvingRequestedSession,
  open,
  onOpenChange,
  title,
  description,
}: AgentSessionTranscriptDialogProps): ReactElement {
  const { model } = useReadonlySessionTranscriptSurfaceModel({
    activeWorkspace,
    taskId,
    sessionId,
    ...(persistedRecords ? { persistedRecords } : {}),
    ...(fallbackSession ? { fallbackSession } : {}),
    isResolvingRequestedSession,
  });
  const resolvedTitle = resolveAgentSessionDialogTitle(title, model.thread.session?.title);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,960px)] max-w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-card px-6 py-4">
          <DialogTitle>{resolvedTitle}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 bg-background">
          <AgentChatSurface model={model} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
