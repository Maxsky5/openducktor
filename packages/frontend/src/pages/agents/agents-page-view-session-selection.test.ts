import { describe, expect, test } from "bun:test";
import {
  agentSessionIdentityKey,
  parseAgentSessionIdentityKey,
} from "@/lib/agent-session-identity";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { createAgentSessionFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  groupSessionsByTaskId,
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

  test("uses the selected route identity before the read model materializes a summary", () => {
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

    const sessionKey = agentSessionIdentityKey(sessionSummary);
    const routeIdentity = parseAgentSessionIdentityKey(sessionKey);
    const loadingSelection = resolveAgentStudioViewSessionSelection({
      sessionSummaries: [],
      sessionKey,
      sessionIdentity: routeIdentity,
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      sessionlessRole: "build",
    });

    expect(loadingSelection).toEqual({
      role: "build",
      sessionSummary: null,
      sessionIdentity: routeIdentity,
    });

    const materializedSelection = resolveAgentStudioViewSessionSelection({
      sessionSummaries: [sessionSummary],
      sessionKey,
      sessionIdentity: routeIdentity,
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      sessionlessRole: "build",
    });

    expect(materializedSelection.sessionSummary).toBe(sessionSummary);
    expect(materializedSelection.sessionIdentity).toEqual({
      externalSessionId: sessionSummary.externalSessionId,
      runtimeKind: "opencode",
      workingDirectory: "/repo/live",
    });
  });

  test("uses a concrete selected identity before summaries materialize", () => {
    const sessionIdentity = {
      externalSessionId: "session-started",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/live",
    };
    const selection = resolveAgentStudioViewSessionSelection({
      sessionSummaries: [],
      sessionKey: "session-started",
      sessionIdentity,
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      sessionlessRole: "build",
    });

    expect(selection).toEqual({
      role: "build",
      sessionSummary: null,
      sessionIdentity,
    });
  });

  test("resolves duplicated external ids by full session identity", () => {
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
      sessionKey: agentSessionIdentityKey(liveBuildSummary),
      sessionIdentity: parseAgentSessionIdentityKey(agentSessionIdentityKey(liveBuildSummary)),
      hasExplicitRoleParam: true,
      roleFromQuery: "qa",
      selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
      sessionlessRole: "qa",
    });

    expect(selection.sessionSummary).toBe(liveBuildSummary);
    expect(selection.sessionIdentity).toEqual({
      externalSessionId: "shared-session-id",
      runtimeKind: "opencode",
      workingDirectory: "/repo/live",
    });
    expect(selection.role).toBe("build");
  });

  test("sanitizes the selected session identity before resolving view selection", () => {
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
        sessionKey: agentSessionIdentityKey(sessionSummary),
        sessionIdentity: parseAgentSessionIdentityKey(agentSessionIdentityKey(sessionSummary)),
        sessionSummaries: [sessionSummary],
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
        selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
        sessionlessRole: "build",
      }).sessionIdentity?.externalSessionId,
    ).toBe("session-summary");
    expect(
      resolveAgentStudioViewSessionSelection({
        sessionKey: "session-unknown",
        sessionIdentity: null,
        sessionSummaries: [sessionSummary],
        hasExplicitRoleParam: true,
        roleFromQuery: "planner",
        selectedTask: createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
        sessionlessRole: "planner",
      }).sessionIdentity?.externalSessionId,
    ).toBeUndefined();
    expect(
      resolveAgentStudioViewSessionSelection({
        sessionKey: "session-other-task",
        sessionIdentity: null,
        sessionSummaries: [sessionSummary],
        hasExplicitRoleParam: false,
        roleFromQuery: "build",
        selectedTask: createTaskCardFixture({ id: "task-1", status: "in_progress" }),
        sessionlessRole: "build",
      }).sessionIdentity?.externalSessionId,
    ).toBe("session-summary");
  });
});
