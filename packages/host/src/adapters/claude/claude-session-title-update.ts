import type { AgentSessionControlUpdateTitleInput } from "@openducktor/contracts";
import { withSummaryTitle } from "@openducktor/core";
import { renameClaudeSessionIfNeeded } from "./claude-agent-sdk-session-io";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import type { ClaudeSessionStore } from "./claude-agent-sdk-types";
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
