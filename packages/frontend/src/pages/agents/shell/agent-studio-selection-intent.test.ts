import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { isSelectionIntentResolved } from "./agent-studio-selection-intent";

describe("agent-studio-selection-intent", () => {
  test("resolves a sessionless role intent when the query has no concrete session", () => {
    expect(
      isSelectionIntentResolved({
        selectionIntent: {
          taskId: "task-1",
          sessionIdentity: null,
          role: "build",
        },
        taskIdParam: "task-1",
        sessionKeyParam: null,
        roleFromQuery: "build",
      }),
    ).toBe(true);

    expect(
      isSelectionIntentResolved({
        selectionIntent: {
          taskId: "task-1",
          sessionIdentity: null,
          role: "build",
        },
        taskIdParam: "task-1",
        sessionKeyParam: "session-1",
        roleFromQuery: "build",
      }),
    ).toBe(false);
  });

  test("resolves a session intent only when task, role, and session match", () => {
    const selectionIntent = {
      taskId: "task-1",
      sessionIdentity: {
        externalSessionId: "session-1",
        runtimeKind: "opencode" as const,
        workingDirectory: "/repo",
      },
      role: "planner" as const,
    };
    const selectionIntentSessionKey = agentSessionIdentityKey(selectionIntent.sessionIdentity);

    expect(
      isSelectionIntentResolved({
        selectionIntent,
        taskIdParam: "task-1",
        sessionKeyParam: selectionIntentSessionKey,
        roleFromQuery: "planner",
      }),
    ).toBe(true);
    expect(
      isSelectionIntentResolved({
        selectionIntent,
        taskIdParam: "task-1",
        sessionKeyParam: null,
        roleFromQuery: "planner",
      }),
    ).toBe(false);
    expect(
      isSelectionIntentResolved({
        selectionIntent,
        taskIdParam: "task-1",
        sessionKeyParam: selectionIntentSessionKey,
        roleFromQuery: "build",
      }),
    ).toBe(false);
  });
});
