import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  groupSessionsByTaskId,
  resolveAgentStudioViewSessionParam,
  resolveAgentStudioViewSessionSelection,
} from "./agents-page-selection";

describe("Agent Studio view session selection", () => {
  test("groups sessions by task with newest sessions first", () => {
    const firstTaskOneOld = createAgentSessionFixture({
      externalSessionId: "session-old",
      taskId: "task-1",
      startedAt: "2026-02-22T10:00:00.000Z",
    });
    const firstTaskOneNew = createAgentSessionFixture({
      externalSessionId: "session-new",
      taskId: "task-1",
      startedAt: "2026-02-22T11:00:00.000Z",
    });
    const firstTaskTwo = createAgentSessionFixture({
      externalSessionId: "session-2-old",
      taskId: "task-2",
      startedAt: "2026-02-22T09:00:00.000Z",
    });

    const grouped = groupSessionsByTaskId(
      [firstTaskOneOld, firstTaskOneNew, firstTaskTwo].map(toAgentSessionSummary),
    );

    expect(grouped.get("task-1")?.map((session) => session.externalSessionId)).toEqual([
      "session-new",
      "session-old",
    ]);
    expect(grouped.get("task-2")?.map((session) => session.externalSessionId)).toEqual([
      "session-2-old",
    ]);
  });

  test("keeps grouped session order stable when input order changes", () => {
    const sessionOld = createAgentSessionFixture({
      externalSessionId: "session-old",
      taskId: "task-1",
      startedAt: "2026-02-22T10:00:00.000Z",
    });
    const sessionNew = createAgentSessionFixture({
      externalSessionId: "session-new",
      taskId: "task-1",
      startedAt: "2026-02-22T11:00:00.000Z",
    });

    const first = groupSessionsByTaskId([sessionOld, sessionNew].map(toAgentSessionSummary));
    const second = groupSessionsByTaskId([sessionNew, sessionOld].map(toAgentSessionSummary));

    expect(first.get("task-1")?.map((session) => session.externalSessionId)).toEqual([
      "session-new",
      "session-old",
    ]);
    expect(second.get("task-1")?.map((session) => session.externalSessionId)).toEqual([
      "session-new",
      "session-old",
    ]);
  });

  test("resolves selected route from persisted records until a session summary exists", () => {
    const sessionSummary = toAgentSessionSummary(
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "session-summary",
        taskId: "task-1",
        role: "build",
        status: "idle",
        startedAt: "2026-02-22T12:00:00.000Z",
        workingDirectory: "/repo/live",
      }),
    );
    const persistedSession: AgentSessionRecord = {
      runtimeKind: "codex",
      externalSessionId: "session-persisted",
      role: "planner",
      startedAt: "2026-02-22T11:00:00.000Z",
      workingDirectory: "/repo/persisted",
      selectedModel: null,
    };

    const persistedSelection = resolveAgentStudioViewSessionSelection({
      sessionSummaries: [sessionSummary],
      persistedRecords: [persistedSession],
      sessionParam: "session-persisted",
      hasExplicitRoleParam: true,
      roleFromQuery: "planner",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
      fallbackRole: "planner",
    });

    expect(persistedSelection).toEqual({
      role: "planner",
      sessionSummary: null,
      sessionRoute: {
        externalSessionId: "session-persisted",
        runtimeKind: "codex",
        workingDirectory: "/repo/persisted",
      },
    });

    const liveSelection = resolveAgentStudioViewSessionSelection({
      sessionSummaries: [sessionSummary],
      persistedRecords: [
        {
          ...persistedSession,
          externalSessionId: sessionSummary.externalSessionId,
          runtimeKind: "codex",
          workingDirectory: "/repo/stale-persisted",
        },
      ],
      sessionParam: sessionSummary.externalSessionId,
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      fallbackRole: "build",
    });

    expect(liveSelection.sessionSummary).toBe(sessionSummary);
    expect(liveSelection.sessionRoute).toEqual({
      externalSessionId: sessionSummary.externalSessionId,
      runtimeKind: "opencode",
      workingDirectory: "/repo/live",
    });
  });

  test("keeps only summarized or persisted session params for the visible task", () => {
    const sessionSummary = toAgentSessionSummary(
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "session-summary",
        taskId: "task-1",
      }),
    );
    const persistedSession: AgentSessionRecord = {
      runtimeKind: "codex",
      externalSessionId: "session-persisted",
      role: "planner",
      startedAt: "2026-02-22T11:00:00.000Z",
      workingDirectory: "/repo/persisted",
      selectedModel: null,
    };

    expect(
      resolveAgentStudioViewSessionParam({
        sessionParam: "session-summary",
        sessionSummaries: [sessionSummary],
        persistedRecords: [persistedSession],
      }),
    ).toBe("session-summary");
    expect(
      resolveAgentStudioViewSessionParam({
        sessionParam: "session-persisted",
        sessionSummaries: [sessionSummary],
        persistedRecords: [persistedSession],
      }),
    ).toBe("session-persisted");
    expect(
      resolveAgentStudioViewSessionParam({
        sessionParam: "session-other-task",
        sessionSummaries: [sessionSummary],
        persistedRecords: [persistedSession],
      }),
    ).toBeNull();
  });
});
