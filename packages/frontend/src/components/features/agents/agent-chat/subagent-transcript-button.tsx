import { Eye } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SubagentMeta } from "./agent-chat-message-card-model.types";
import {
  type OpenAgentSessionTranscriptRequest,
  useOptionalAgentSessionTranscriptDialog,
} from "./agent-session-transcript-dialog-context";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";
import {
  type ParentSessionRuntimeContext,
  toSubagentTranscriptTarget,
} from "./subagent-session-key";

type SubagentTranscriptButtonProps = {
  parentSession: ParentSessionRuntimeContext | null;
  meta: SubagentMeta;
  className?: string;
  onOpenTranscript?: (request: OpenAgentSessionTranscriptRequest) => void;
};

const buildTranscriptRequest = (
  target: AgentSessionTranscriptTarget,
): OpenAgentSessionTranscriptRequest => {
  return {
    target,
    title: "Subagent activity",
    description: "View what this subagent did.",
  };
};

export function SubagentTranscriptButton({
  parentSession,
  meta,
  className,
  onOpenTranscript,
}: SubagentTranscriptButtonProps): ReactElement | null {
  const transcriptDialog = useOptionalAgentSessionTranscriptDialog();
  const openTranscript = onOpenTranscript ?? transcriptDialog?.openSessionTranscript;
  const transcriptTarget = toSubagentTranscriptTarget({
    externalSessionId: meta.externalSessionId,
    parentSession,
  });

  if (!openTranscript || !transcriptTarget) {
    return null;
  }

  const handleOpen = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    openTranscript(buildTranscriptRequest(transcriptTarget));
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className={cn("shrink-0", className)}
      aria-label="View subagent session"
      title="View subagent session"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={handleOpen}
    >
      <Eye className="size-3.5" />
      <span>Subagent session</span>
    </Button>
  );
}
