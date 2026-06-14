import { describe, expect, test } from "bun:test";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  groupSessionsByTaskId,
  resolveAgentStudioViewSessionSelection,
} from "./agents-page-selection";

const externalSessionParam = (externalSessionId: string) => externalSessionId;

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

  test("waits for the read model to materialize a selected route as a session summary", () => {
    const sessionSummary = toAgentSessionSummary(
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "session-reloaded",
        taskId: "task-1",
        role: "build",
        status: "idle",
        startedAt: "2026-02-22T12:00:00.000Z",
        workingDirectory: "/repo/live",
      }),
    );

    const loadingSelection = resolveAgentStudioViewSessionSelection({
      sessionSummaries: [],
      externalSessionId: externalSessionParam("session-reloaded"),
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      fallbackRole: "build",
    });

    expect(loadingSelection).toEqual({
      role: "build",
      sessionSummary: null,
      sessionRoute: null,
    });

    const materializedSelection = resolveAgentStudioViewSessionSelection({
      sessionSummaries: [sessionSummary],
      externalSessionId: externalSessionParam(sessionSummary.externalSessionId),
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      fallbackRole: "build",
    });

    expect(materializedSelection.sessionSummary).toBe(sessionSummary);
    expect(materializedSelection.sessionRoute).toEqual({
      externalSessionId: sessionSummary.externalSessionId,
      runtimeKind: "opencode",
      workingDirectory: "/repo/live",
    });
  });

  test("does not resolve an ambiguous external id across visible session summaries", () => {
    const liveBuildSummary = toAgentSessionSummary(
      createAgentSessionFixture({
        runtimeKind: "opencode",
        externalSessionId: "shared-session-id",
        taskId: "task-1",
        role: "build",
        status: "idle",
        startedAt: "2026-02-22T12:00:00.000Z",
        workingDirectory: "/repo/live",
      }),
    );
    const livePlannerSummary = toAgentSessionSummary(
      createAgentSessionFixture({
        runtimeKind: "codex",
        externalSessionId: "shared-session-id",
        taskId: "task-1",
        role: "planner",
        status: "idle",
        startedAt: "2026-02-22T11:00:00.000Z",
        workingDirectory: "/repo/other",
      }),
    );

    const selection = resolveAgentStudioViewSessionSelection({
      sessionSummaries: [liveBuildSummary, livePlannerSummary],
      externalSessionId: externalSessionParam("shared-session-id"),
      hasExplicitRoleParam: true,
      roleFromQuery: "qa",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      fallbackRole: "qa",
    });

    expect(selection).toEqual({
      role: "qa",
      sessionSummary: null,
      sessionRoute: null,
    });
  });

  test("sanitizes the route session before resolving view selection", () => {
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

    expect(
      resolveAgentStudioViewSessionSelection({
        externalSessionId: externalSessionParam("session-summary"),
        sessionSummaries: [sessionSummary],
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
        selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
        fallbackRole: "build",
      }).sessionRoute?.externalSessionId,
    ).toBe("session-summary");
    expect(
      resolveAgentStudioViewSessionSelection({
        externalSessionId: externalSessionParam("session-unknown"),
        sessionSummaries: [sessionSummary],
        hasExplicitRoleParam: true,
        roleFromQuery: "planner",
        selectedTask: createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
        fallbackRole: "planner",
      }).sessionRoute?.externalSessionId,
    ).toBeUndefined();
    expect(
      resolveAgentStudioViewSessionSelection({
        externalSessionId: externalSessionParam("session-other-task"),
        sessionSummaries: [sessionSummary],
        hasExplicitRoleParam: false,
        roleFromQuery: "build",
        selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
        fallbackRole: "build",
      }).sessionRoute?.externalSessionId,
    ).toBe("session-summary");
  });
});
