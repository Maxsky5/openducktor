import type { RuntimeKind } from "@openducktor/contracts";
import { Eye } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SubagentMeta } from "./agent-chat-message-card-model.types";
import {
  type OpenAgentSessionTranscriptRequest,
  useOptionalAgentSessionTranscriptDialog,
} from "./agent-session-transcript-dialog-context";
import type { RuntimeSessionTranscriptTarget } from "./readonly-transcript/runtime-session-transcript-target";

type SubagentTranscriptButtonProps = {
  sessionRuntimeKind?: RuntimeKind | null;
  sessionWorkingDirectory?: string | null | undefined;
  meta: SubagentMeta;
  className?: string;
  onOpenTranscript?: (request: OpenAgentSessionTranscriptRequest) => void;
};

type TranscriptTargetInput = {
  externalSessionId: string | null | undefined;
  sessionRuntimeKind: RuntimeKind | null | undefined;
  sessionWorkingDirectory: string | null | undefined;
};

const buildTranscriptRequest = (
  target: RuntimeSessionTranscriptTarget,
): OpenAgentSessionTranscriptRequest => {
  return {
    target,
    title: "Subagent activity",
    description: "View what this subagent did.",
  };
};

const buildTranscriptTarget = ({
  externalSessionId,
  sessionRuntimeKind,
  sessionWorkingDirectory,
}: TranscriptTargetInput): RuntimeSessionTranscriptTarget | null => {
  const resolvedExternalSessionId = externalSessionId?.trim() || null;
  const workingDirectory = sessionWorkingDirectory?.trim() || null;

  if (!resolvedExternalSessionId || !sessionRuntimeKind || !workingDirectory) {
    return null;
  }

  return {
    externalSessionId: resolvedExternalSessionId,
    runtimeKind: sessionRuntimeKind,
    workingDirectory,
  };
};

export function SubagentTranscriptButton({
  sessionRuntimeKind,
  sessionWorkingDirectory,
  meta,
  className,
  onOpenTranscript,
}: SubagentTranscriptButtonProps): ReactElement | null {
  const transcriptDialog = useOptionalAgentSessionTranscriptDialog();
  const openTranscript = onOpenTranscript ?? transcriptDialog?.openSessionTranscript;
  const transcriptTarget = buildTranscriptTarget({
    externalSessionId: meta.externalSessionId,
    sessionRuntimeKind,
    sessionWorkingDirectory,
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
