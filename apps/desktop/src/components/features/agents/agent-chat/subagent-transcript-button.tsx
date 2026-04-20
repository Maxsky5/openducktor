import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { Eye } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { SubagentMeta } from "./agent-chat-message-card-model.types";
import {
  type OpenAgentSessionTranscriptRequest,
  useOptionalAgentSessionTranscriptDialog,
} from "./use-agent-session-transcript-dialog";

type SubagentTranscriptButtonProps = {
  taskId: string | null;
  sessionRole?: AgentRole | null;
  sessionRuntimeKind?: RuntimeKind | null;
  sessionWorkingDirectory?: string | null | undefined;
  meta: SubagentMeta;
  onOpenTranscript?: (request: OpenAgentSessionTranscriptRequest) => void;
};

const buildTranscriptRequest = (
  taskId: string,
  sessionId: string,
  fallbackSession?: OpenAgentSessionTranscriptRequest["fallbackSession"],
): OpenAgentSessionTranscriptRequest => ({
  taskId,
  sessionId,
  title: "Subagent activity",
  description: "View what this subagent did.",
  ...(fallbackSession ? { fallbackSession } : {}),
});

export function SubagentTranscriptButton({
  taskId,
  sessionRole,
  sessionRuntimeKind,
  sessionWorkingDirectory,
  meta,
  onOpenTranscript,
}: SubagentTranscriptButtonProps): ReactElement | null {
  const transcriptDialog = useOptionalAgentSessionTranscriptDialog();
  const sessionId = meta.sessionId?.trim() || null;
  const openTranscript = onOpenTranscript ?? transcriptDialog?.openSessionTranscript;
  const fallbackSession =
    taskId &&
    sessionRole &&
    sessionRuntimeKind &&
    sessionWorkingDirectory &&
    sessionWorkingDirectory.trim().length > 0
      ? {
          role: sessionRole,
          runtimeKind: sessionRuntimeKind,
          workingDirectory: sessionWorkingDirectory,
        }
      : undefined;

  if (!taskId || !sessionId || !openTranscript) {
    return null;
  }

  const handleOpen = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    openTranscript(buildTranscriptRequest(taskId, sessionId, fallbackSession));
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
      aria-label="View subagent activity"
      title="View subagent activity"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={handleOpen}
    >
      <Eye className="size-3.5" />
    </Button>
  );
}
