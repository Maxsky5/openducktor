import type { AgentSessionRecord } from "@openducktor/contracts";
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
import { useReadonlySessionTranscriptSurfaceModel } from "./use-readonly-session-transcript-surface-model";

type AgentSessionTranscriptDialogProps = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  sessionId: string | null;
  persistedRecords?: AgentSessionRecord[];
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
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,960px)] max-w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-card px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 bg-background">
          <AgentChatSurface model={model} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
