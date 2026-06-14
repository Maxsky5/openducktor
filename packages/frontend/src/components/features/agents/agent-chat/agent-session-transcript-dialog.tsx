import type { ReactElement } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { AgentChatSurface } from "./agent-chat";
import { resolveAgentSessionDialogTitle } from "./agent-session-dialog-title";
import { useSessionTranscriptSurfaceModel } from "./readonly-transcript/use-session-transcript-surface-model";

type AgentSessionTranscriptDialogProps = {
  activeWorkspace: ActiveWorkspace | null;
  target: AgentSessionIdentity | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
};

export function AgentSessionTranscriptDialog({
  activeWorkspace,
  target,
  open,
  onOpenChange,
  title,
  description,
}: AgentSessionTranscriptDialogProps): ReactElement {
  const { model } = useSessionTranscriptSurfaceModel({
    isOpen: open,
    activeWorkspace,
    target,
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
