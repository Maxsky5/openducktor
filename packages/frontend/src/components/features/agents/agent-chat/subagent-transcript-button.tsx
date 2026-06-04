import type { RuntimeRef } from "@openducktor/contracts";
import { Eye } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { SubagentMeta } from "./agent-chat-message-card-model.types";
import {
  type OpenAgentSessionTranscriptRequest,
  useOptionalAgentSessionTranscriptDialog,
} from "./agent-session-transcript-dialog-context";
import type { RuntimeSessionTranscriptSource } from "./readonly-transcript/runtime-session-transcript-source";

type SubagentTranscriptButtonProps = {
  sessionRuntimeRef?: RuntimeRef | null;
  sessionWorkingDirectory?: string | null | undefined;
  pendingApprovals?: AgentApprovalRequest[] | undefined;
  pendingQuestions?: AgentQuestionRequest[] | undefined;
  meta: SubagentMeta;
  className?: string;
  onOpenTranscript?: (request: OpenAgentSessionTranscriptRequest) => void;
};

type TranscriptSourceInput = {
  sessionRuntimeRef: RuntimeRef | null | undefined;
  sessionWorkingDirectory: string | null | undefined;
  isLive: boolean;
  pendingApprovals: AgentApprovalRequest[] | undefined;
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
  sessionRuntimeRef,
  sessionWorkingDirectory,
  isLive,
  pendingApprovals,
  pendingQuestions,
}: TranscriptSourceInput): RuntimeSessionTranscriptSource | null => {
  const workingDirectory = sessionWorkingDirectory?.trim() || null;

  if (!sessionRuntimeRef || !workingDirectory) {
    return null;
  }

  return {
    runtimeRef: sessionRuntimeRef,
    workingDirectory,
    ...(isLive ? { isLive: true } : {}),
    ...(pendingApprovals ? { pendingApprovals } : {}),
    ...(pendingQuestions ? { pendingQuestions } : {}),
  };
};

export function SubagentTranscriptButton({
  sessionRuntimeRef,
  sessionWorkingDirectory,
  pendingApprovals,
  pendingQuestions,
  meta,
  className,
  onOpenTranscript,
}: SubagentTranscriptButtonProps): ReactElement | null {
  const transcriptDialog = useOptionalAgentSessionTranscriptDialog();
  const externalSessionId = meta.externalSessionId?.trim() || null;
  const openTranscript = onOpenTranscript ?? transcriptDialog?.openSessionTranscript;
  const transcriptSource = buildTranscriptSource({
    sessionRuntimeRef,
    sessionWorkingDirectory,
    isLive: isLiveSubagentStatus(meta.status),
    pendingApprovals,
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
