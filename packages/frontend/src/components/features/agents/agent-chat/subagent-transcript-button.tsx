import type { RuntimeKind } from "@openducktor/contracts";
import { Eye } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentPermissionRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { SubagentMeta } from "./agent-chat-message-card-model.types";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import {
  type OpenAgentSessionTranscriptRequest,
  useOptionalAgentSessionTranscriptDialog,
} from "./use-agent-session-transcript-dialog";

type SubagentTranscriptButtonProps = {
  sessionRuntimeKind?: RuntimeKind | null;
  sessionRuntimeId?: string | null;
  sessionWorkingDirectory?: string | null | undefined;
  pendingPermissions?: AgentPermissionRequest[] | undefined;
  pendingQuestions?: AgentQuestionRequest[] | undefined;
  meta: SubagentMeta;
  className?: string;
  onOpenTranscript?: (request: OpenAgentSessionTranscriptRequest) => void;
};

type TranscriptSourceInput = {
  sessionRuntimeKind: RuntimeKind | null | undefined;
  sessionRuntimeId: string | null | undefined;
  sessionWorkingDirectory: string | null | undefined;
  isLive: boolean;
  pendingPermissions: AgentPermissionRequest[] | undefined;
  pendingQuestions: AgentQuestionRequest[] | undefined;
};

const isLiveSubagentStatus = (status: SubagentMeta["status"]): boolean => {
  return status === "pending" || status === "running";
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
  sessionRuntimeId,
  sessionWorkingDirectory,
  isLive,
  pendingPermissions,
  pendingQuestions,
}: TranscriptSourceInput): RuntimeSessionTranscriptSource | null => {
  const runtimeId = sessionRuntimeId?.trim() || null;
  const workingDirectory = sessionWorkingDirectory?.trim() || null;

  if (!sessionRuntimeKind || !runtimeId || !workingDirectory) {
    return null;
  }

  return {
    runtimeKind: sessionRuntimeKind,
    runtimeId,
    workingDirectory,
    ...(isLive ? { isLive: true } : {}),
    ...(pendingPermissions ? { pendingPermissions } : {}),
    ...(pendingQuestions ? { pendingQuestions } : {}),
  };
};

export function SubagentTranscriptButton({
  sessionRuntimeKind,
  sessionRuntimeId,
  sessionWorkingDirectory,
  pendingPermissions,
  pendingQuestions,
  meta,
  className,
  onOpenTranscript,
}: SubagentTranscriptButtonProps): ReactElement | null {
  const transcriptDialog = useOptionalAgentSessionTranscriptDialog();
  const externalSessionId = meta.externalSessionId?.trim() || null;
  const openTranscript = onOpenTranscript ?? transcriptDialog?.openSessionTranscript;
  const transcriptSource = buildTranscriptSource({
    sessionRuntimeKind,
    sessionRuntimeId,
    sessionWorkingDirectory,
    isLive: isLiveSubagentStatus(meta.status),
    pendingPermissions,
    pendingQuestions,
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
