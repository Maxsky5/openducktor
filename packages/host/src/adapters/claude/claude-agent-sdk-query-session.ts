import { type AgentSessionRef, assertAgentRuntimeQuerySession } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeSession, ClaudeSessionStore } from "./claude-agent-sdk-types";
import { claudeSessionRef } from "./claude-agent-sdk-utils";

export const resolveClaudeQuerySession = (
  store: Pick<ClaudeSessionStore, "get">,
  input: AgentSessionRef,
) => {
  const target = parseClaudeTranscriptTarget(input.externalSessionId);
  const session = store.get(target.sessionId);
  if (session) {
    assertAgentRuntimeQuerySession(
      { ...input, externalSessionId: target.sessionId },
      claudeSessionRef(session),
      session.summary.sessionAssociation,
    );
  }
  return { target, session };
};

export const requireClaudeSession = (
  store: Pick<ClaudeSessionStore, "get">,
  externalSessionId: string,
): ClaudeSession => {
  const session = store.get(externalSessionId);
  if (!session) {
    throw new HostValidationError({
      field: "externalSessionId",
      message: `Unknown Claude session '${externalSessionId}'.`,
      details: { externalSessionId },
    });
  }
  return session;
};
