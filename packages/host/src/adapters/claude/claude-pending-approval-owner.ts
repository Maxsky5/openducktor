import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import { requireClaudeSession } from "./claude-agent-sdk-query-session";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeSessionStore } from "./claude-agent-sdk-types";

export const resolveClaudePendingApprovalOwner = (
  store: ClaudeSessionStore,
  input: AgentSessionLiveRef & { requestId: string },
) => {
  const target = parseClaudeTranscriptTarget(input.externalSessionId);
  const session = requireClaudeSession(store, target.sessionId);
  assertClaudeSessionRef(
    session,
    { ...input, externalSessionId: session.externalSessionId },
    "resolve approval owner",
  );
  const pending = session.pendingApprovals.get(input.requestId);
  if (!pending)
    throw new HostValidationError({
      field: "requestId",
      message: "The approval is no longer pending. Reload the session.",
    });
  const event = pending.event;
  const ownerId = event.childExternalSessionId ?? event.externalSessionId;
  if (
    input.externalSessionId !== ownerId &&
    input.externalSessionId !== (event.parentExternalSessionId ?? session.externalSessionId)
  )
    throw new HostValidationError({
      field: "externalSessionId",
      message: "This session does not own or mirror the selected approval request.",
    });
  const root = {
    repoPath: session.input.repoPath,
    runtimeKind: "claude" as const,
    workingDirectory: session.input.workingDirectory,
    externalSessionId: session.externalSessionId,
  };
  return { owner: { ...root, externalSessionId: ownerId }, root };
};
