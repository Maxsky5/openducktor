import { Eye } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { extractSubagentSessionId } from "./tool-summary";
import {
  type OpenAgentSessionTranscriptRequest,
  useOptionalAgentSessionTranscriptDialog,
} from "./use-agent-session-transcript-dialog";

type SubagentTranscriptButtonProps = {
  taskId: string | null;
  meta: ToolMeta;
  onOpenTranscript?: (request: OpenAgentSessionTranscriptRequest) => void;
};

const buildTranscriptRequest = (
  taskId: string,
  sessionId: string,
): OpenAgentSessionTranscriptRequest => ({
  taskId,
  sessionId,
  title: "Subagent transcript",
  description: `Read-only transcript for subagent session ${sessionId}.`,
});

export function SubagentTranscriptButton({
  taskId,
  meta,
  onOpenTranscript,
}: SubagentTranscriptButtonProps): ReactElement | null {
  const transcriptDialog = useOptionalAgentSessionTranscriptDialog();
  const sessionId = extractSubagentSessionId(meta);
  const openTranscript = onOpenTranscript ?? transcriptDialog?.openSessionTranscript;

  if (!taskId || !sessionId || !openTranscript) {
    return null;
  }

  const handleOpen = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    openTranscript(buildTranscriptRequest(taskId, sessionId));
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
      aria-label="View subagent transcript"
      title="View subagent transcript"
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
