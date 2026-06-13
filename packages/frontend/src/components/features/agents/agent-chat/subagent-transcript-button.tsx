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
import type { RuntimeSessionTranscriptSource } from "./readonly-transcript/runtime-session-transcript-source";

type SubagentTranscriptButtonProps = {
  sessionRuntimeKind?: RuntimeKind | null;
  sessionWorkingDirectory?: string | null | undefined;
  meta: SubagentMeta;
  className?: string;
  onOpenTranscript?: (request: OpenAgentSessionTranscriptRequest) => void;
};

type TranscriptSourceInput = {
  sessionRuntimeKind: RuntimeKind | null | undefined;
  sessionWorkingDirectory: string | null | undefined;
};

const buildTranscriptRequest = (
  externalSessionId: string,
  source: RuntimeSessionTranscriptSource,
): OpenAgentSessionTranscriptRequest => {
  return {
    externalSessionId,
    title: "Subagent activity",
    description: "View what this subagent did.",
    source,
  };
};

const buildTranscriptSource = ({
  sessionRuntimeKind,
  sessionWorkingDirectory,
}: TranscriptSourceInput): RuntimeSessionTranscriptSource | null => {
  const workingDirectory = sessionWorkingDirectory?.trim() || null;

  if (!sessionRuntimeKind || !workingDirectory) {
    return null;
  }

  return {
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
  const externalSessionId = meta.externalSessionId?.trim() || null;
  const openTranscript = onOpenTranscript ?? transcriptDialog?.openSessionTranscript;
  const transcriptSource = buildTranscriptSource({
    sessionRuntimeKind,
    sessionWorkingDirectory,
  });

  if (!externalSessionId || !openTranscript || !transcriptSource) {
    return null;
  }

  const handleOpen = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    openTranscript(buildTranscriptRequest(externalSessionId, transcriptSource));
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
