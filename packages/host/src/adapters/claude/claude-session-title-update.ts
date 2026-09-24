import type { AgentSessionControlUpdateTitleInput } from "@openducktor/contracts";
import {
  type AgentSessionScope,
  type AgentSessionSummary,
  type ResumeAgentSessionInput,
  agentSessionTitle,
  withSummaryTitle,
  withoutSummaryTitle,
} from "@openducktor/core";
import { renameClaudeSessionIfNeeded } from "./claude-agent-sdk-session-io";
import { requireClaudeOpenDucktorMcpForScope } from "./claude-agent-sdk-session-policy";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import type { ClaudeSession, ClaudeSessionStore } from "./claude-agent-sdk-types";
import { fromPromise } from "./claude-agent-sdk-utils";

export const updateClaudeSessionTitle = (
  input: AgentSessionControlUpdateTitleInput,
  dependencies: { sessionStore: ClaudeSessionStore },
) =>
  fromPromise("claudeRuntime.updateSessionTitle", async () => {
    const session = dependencies.sessionStore.get(input.externalSessionId);
    if (!session) {
      return { status: "not_attached" } as const;
    }
    assertClaudeSessionRef(session, input, "update session title");
    await renameClaudeSessionIfNeeded({ session, title: input.title });
    session.summary = withSummaryTitle(session.summary, input.title);
    return { status: "renamed", summary: session.summary } as const;
  });

/**
 * Reconciles a durable title with the runtime on an attach.
 * A failed rename keeps the durable title and the session usable, the summary
 * reports the runtime title, and the next attach retries.
 */
export const reconcileClaudeSessionTitle = async (input: {
  session: ClaudeSession;
  title: string | undefined;
}): Promise<void> => {
  const title = input.title?.trim();
  if (!title || input.session.summary.title === title) {
    return;
  }
  try {
    await renameClaudeSessionIfNeeded({ session: input.session, title });
  } catch {
    input.session.summary = withoutSummaryTitle(input.session.summary);
    return;
  }
  input.session.summary = withSummaryTitle(input.session.summary, title);
};

/**
 * Prepares a retained Claude session for a resume. Validates the ref, requires the
 * OpenDucktor MCP scope, and reconciles the durable title with the runtime.
 */
export const resumeRetainedClaudeSession = async (input: {
  request: ResumeAgentSessionInput;
  runtimeId: string;
  scope: AgentSessionScope;
  session: ClaudeSession;
}): Promise<AgentSessionSummary> => {
  assertClaudeSessionRef(input.session, input.request, "resume");
  await requireClaudeOpenDucktorMcpForScope(input.scope, input.session.query, {
    externalSessionId: input.session.externalSessionId,
    runtimeId: input.runtimeId,
  });
  await reconcileClaudeSessionTitle({
    session: input.session,
    title: agentSessionTitle(input.scope),
  });
  return input.session.summary;
};
