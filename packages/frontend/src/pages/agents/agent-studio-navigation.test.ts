import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createAgentSessionFixture } from "./agent-studio-test-utils";
import {
  buildAgentStudioSelectionQueryUpdate,
  restoreNavigationFromPersistedContext,
} from "./query-sync/agent-studio-navigation";

describe("agent-studio-navigation", () => {
  test("buildAgentStudioSelectionQueryUpdate selects the requested session", () => {
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/session-1",
    });

    expect(
      buildAgentStudioSelectionQueryUpdate({
        taskId: "task-1",
        session,
        role: "spec",
      }),
    ).toEqual({
      task: "task-1",
      session: agentSessionIdentityKey(session),
      agent: "spec",
    });
  });

  test("does not restore a stale persisted session over an explicit task", () => {
    expect(
      restoreNavigationFromPersistedContext(
        {
          taskId: "task-current",
          sessionKey: null,
          role: null,
        },
        {
          taskId: "task-persisted",
          sessionKey: "session-persisted",
          role: "planner",
        },
      ),
    ).toEqual({
      taskId: "task-current",
      sessionKey: null,
      role: "planner",
    });
  });

  test("restores the persisted session when the explicit task matches", () => {
    expect(
      restoreNavigationFromPersistedContext(
        {
          taskId: "task-current",
          sessionKey: null,
          role: null,
        },
        {
          taskId: "task-current",
          sessionKey: "session-persisted",
          role: "planner",
        },
      ),
    ).toEqual({
      taskId: "task-current",
      sessionKey: "session-persisted",
      role: "planner",
    });
  });
});
