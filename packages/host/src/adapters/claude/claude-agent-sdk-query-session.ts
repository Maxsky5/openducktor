import { assertAgentRuntimeQuerySession, type PolicyBoundSessionRef } from "@openducktor/core";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeSessionStore } from "./claude-agent-sdk-types";
import { claudeSessionRef } from "./claude-agent-sdk-utils";

export const resolveClaudeQuerySession = (
  store: Pick<ClaudeSessionStore, "get">,
  input: PolicyBoundSessionRef,
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
