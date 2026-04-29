import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import { createAgentSessionsStore, toAgentSessionSummary } from "./agent-sessions-store";

describe("toAgentSessionSummary", () => {
  test("preserves session working directory for build-session consumers", () => {
    const session = createAgentSessionFixture({
      role: "build",
      workingDirectory: "/repo",
    });

    expect(toAgentSessionSummary(session)).toMatchObject({
      sessionId: session.sessionId,
      externalSessionId: session.externalSessionId,
      role: "build",
      workingDirectory: "/repo",
    });
  });
});

describe("createAgentSessionsStore activity snapshots", () => {
  test("reuses the activity snapshot when only non-activity fields change", () => {
    const store = createAgentSessionsStore();
    const baseSession = createAgentSessionFixture({
      sessionId: "session-1",
      taskId: "task-1",
      status: "running",
    });

    store.setSessionsById({ [baseSession.sessionId]: baseSession });

    const initialSnapshot = store.getActivitySessionsSnapshot();
    const updatedSession = {
      ...baseSession,
      messages: [{ id: "m-1", role: "assistant" as const, content: "Working", timestamp: "now" }],
      draftAssistantText: "draft update",
      todos: [
        {
          id: "todo-1",
          content: "Check logs",
          status: "pending" as const,
          priority: "medium" as const,
        },
      ],
    };

    store.setSessionsById({ [updatedSession.sessionId]: updatedSession });

    expect(store.getActivitySessionsSnapshot()).toBe(initialSnapshot);
  });

  test("publishes a new activity snapshot when pending input visibility changes", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      sessionId: "session-1",
      taskId: "task-1",
      status: "running",
      pendingPermissions: [],
    });

    store.setSessionsById({ [session.sessionId]: session });

    const initialSnapshot = store.getActivitySessionsSnapshot();
    const updatedSession = {
      ...session,
      pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: ["**/*"] }],
    };

    store.setSessionsById({ [updatedSession.sessionId]: updatedSession });

    const nextSnapshot = store.getActivitySessionsSnapshot();
    expect(nextSnapshot).not.toBe(initialSnapshot);
    expect(nextSnapshot[0]).toMatchObject({
      sessionId: "session-1",
      hasPendingPermissions: true,
      hasPendingQuestions: false,
    });
  });

  test("omits transcript-only sessions from activity snapshots", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      sessionId: "session-1",
      taskId: "task-1",
      status: "running",
      purpose: "transcript",
      role: "build",
      scenario: "build_implementation_start",
    });

    store.setSessionsById({ [session.sessionId]: session });

    expect(store.getActivitySessionsSnapshot()).toEqual([]);
  });
});
