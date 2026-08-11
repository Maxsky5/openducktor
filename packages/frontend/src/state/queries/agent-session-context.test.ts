import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveLoadContextInput } from "@openducktor/contracts";
import { agentSessionContextQueryKeys } from "./agent-session-context";

const sessionRefFixture = {
  repoPath: "/repo/",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree/",
  externalSessionId: "session-1",
} satisfies AgentSessionLiveLoadContextInput;

describe("agent session context query keys", () => {
  test("keeps absent, repository, and workflow session scopes distinct", () => {
    const withoutScope = agentSessionContextQueryKeys.usage(sessionRefFixture);
    const repositoryScope = agentSessionContextQueryKeys.usage({
      ...sessionRefFixture,
      sessionScope: { kind: "repository" },
    });
    const workflowScope = agentSessionContextQueryKeys.usage({
      ...sessionRefFixture,
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    });

    expect(withoutScope).toEqual([
      "agent-session-context",
      "/repo",
      "claude",
      "/repo/worktree",
      "session-1",
      null,
      null,
      null,
    ]);
    expect(repositoryScope).toEqual([
      "agent-session-context",
      "/repo",
      "claude",
      "/repo/worktree",
      "session-1",
      "repository",
      null,
      null,
    ]);
    expect(workflowScope).toEqual([
      "agent-session-context",
      "/repo",
      "claude",
      "/repo/worktree",
      "session-1",
      "workflow",
      "task-1",
      "build",
    ]);
  });
});
