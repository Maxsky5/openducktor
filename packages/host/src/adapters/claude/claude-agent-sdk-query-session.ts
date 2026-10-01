import { type AgentSessionRef, assertAgentRuntimeQuerySession } from "@openducktor/core";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeSessionStore } from "./claude-agent-sdk-types";
import { claudeSessionRef, fromPromise } from "./claude-agent-sdk-utils";
import { loadClaudeSessionMetadata } from "./claude-session-metadata";

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

/** Checks a retained session against the requested scope, then reads its saved metadata. */
export const readClaudeMetadata = (
  store: Pick<ClaudeSessionStore, "get">,
  input: AgentSessionRef,
) =>
  fromPromise("claudeRuntime.loadSessionMetadata", async () => {
    resolveClaudeQuerySession(store, input);
    return loadClaudeSessionMetadata(input);
  });
