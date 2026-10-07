import { describe, expect, test } from "bun:test";
import {
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import { resolveAgentStudioNavigationState } from "./agent-studio-navigation-state";
import { createAgentSessionSummaryFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  createAgentStudioRouteSelectionState,
  toAgentStudioSessionSelection,
  toAgentStudioTaskSelection,
} from "./shell/agent-studio-selection-state";

const createTask = (id: string) => createTaskCardFixture({ id, title: id });

const createSession = (taskId: string, externalSessionId: string) =>
  createAgentSessionSummaryFixture({
    externalSessionId: `ext-${externalSessionId}`,
    sessionAssociation: { kind: "workflow", taskId: taskId, role: "spec" },
  });

const sessionExternalIdParam = (
  session: ReturnType<typeof createAgentSessionSummaryFixture>,
): string => session.externalSessionId;

const createNavigationState = (
  overrides: Partial<Parameters<typeof resolveAgentStudioNavigationState>[0]> = {},
) => {
  const base = {
    isWorkspaceRestorePending: false,
    isLoadingTasks: false,
    sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo"),
    tasks: [createTask("task-1")],
    sessions: [],
    taskIdParam: "task-1",
    sessionExternalIdParam: null,
    hasExplicitRoleParam: false,
    roleFromQuery: "spec" as const,
    ...overrides,
  };
  return resolveAgentStudioNavigationState({
    ...base,
    selectionState:
      overrides.selectionState ??
      createAgentStudioRouteSelectionState({
        isWorkspaceRestorePending: base.isWorkspaceRestorePending,
        taskIdParam: base.taskIdParam,
        sessionExternalIdParam: base.sessionExternalIdParam,
        hasExplicitRoleParam: base.hasExplicitRoleParam,
        roleFromQuery: base.roleFromQuery,
      }),
  });
};

describe("resolveAgentStudioNavigationState", () => {
  test("keeps an unavailable requested task selected without replacing its URL", () => {
    const state = createNavigationState({
      tasks: [createTask("task-1")],
      taskIdParam: "missing-task",
    });
    expect(state.queryUpdate).toBeNull();
    expect(state.view.taskId).toBe("missing-task");
    expect(state.view.selectedTask).toBeNull();
  });

  test("does not resolve an external session id without its task id", () => {
    const selectedSession = createSession("task-2", "session-2");

    const state = createNavigationState({
      tasks: [createTask("task-1"), createTask("task-2")],
      sessions: [selectedSession],
      taskIdParam: "",
      sessionExternalIdParam: sessionExternalIdParam(selectedSession),
    });

    expect(state.routeSessionResolution).toEqual({
      kind: "missing",
      sessionExternalId: selectedSession.externalSessionId,
    });
    expect(state.queryUpdate).toBeNull();
  });

  test("does not clear a session deep link before the session catalog can resolve it", () => {
    const state = createNavigationState({
      tasks: [createTask("task-1")],
      taskIdParam: "missing-task",
      sessionExternalIdParam: "session-2",
      sessionReadModelLoadState: loadingAgentSessionReadModelLoadState("/repo"),
    });
    expect(state.routeSessionResolution).toEqual({
      kind: "pending",
      sessionExternalId: "session-2",
    });
    expect(state.queryUpdate).toBeNull();
  });

  test("preserves a matching session while task session metadata refreshes", () => {
    const session = createSession("task-1", "session-1");
    const state = createNavigationState({
      sessions: [session],
      sessionExternalIdParam: session.externalSessionId,
      sessionReadModelLoadState: loadingAgentSessionReadModelLoadState("/repo"),
    });

    expect(state.routeSessionResolution).toEqual({
      kind: "found",
      session,
    });
    expect(state.view.sessionIdentity).toEqual({
      externalSessionId: session.externalSessionId,
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
    });
  });

  test("keeps a missing explicit session selected without default fallback", () => {
    const state = createNavigationState({
      tasks: [createTask("task-1")],
      taskIdParam: "task-1",
      sessionExternalIdParam: "removed-session",
    });

    expect(state.routeSessionResolution).toEqual({
      kind: "missing",
      sessionExternalId: "removed-session",
    });
    expect(state.view.sessionIdentity).toBeNull();
    expect(state.queryUpdate).toBeNull();
  });

  test("does not resolve an external session id against another task", () => {
    const selectedSession = createSession("task-2", "session-2");

    const state = createNavigationState({
      tasks: [createTask("task-1"), createTask("task-2")],
      sessions: [selectedSession],
      taskIdParam: "task-1",
      sessionExternalIdParam: sessionExternalIdParam(selectedSession),
    });

    expect(state.routeSessionResolution.kind).toBe("missing");
    expect(state.queryUpdate).toBeNull();
  });

  test("aligns a stale role with the resolved task session", () => {
    const resolvedSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "ext-session-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
    });

    expect(
      createNavigationState({
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(resolvedSession),
        sessions: [resolvedSession],
        roleFromQuery: "spec",
      }).queryUpdate,
    ).toEqual({
      agent: "planner",
    });
  });

  test("does not replace an explicit identity with a different runtime or worktree", () => {
    const resolvedSession = createAgentSessionSummaryFixture({
      runtimeKind: "codex",
      externalSessionId: "session-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },

      workingDirectory: "/repo/worktrees/authoritative",
    });
    const state = createNavigationState({
      sessions: [resolvedSession],
      taskIdParam: "task-1",
      sessionExternalIdParam: "session-1",
      hasExplicitRoleParam: true,
      roleFromQuery: "build",
      selectionState: toAgentStudioSessionSelection({
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/stale",
        taskId: "task-1",
        role: "build",
      }),
    });

    expect(state.view.sessionIdentity).toEqual({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/stale",
    });
    expect(state.routeSessionResolution.kind).toBe("missing");
  });

  test("keeps an unresolved explicit session actionable after repository read-model failure", () => {
    const state = createNavigationState({
      taskIdParam: "task-1",
      sessionExternalIdParam: "session-1",
      sessionReadModelLoadState: failedAgentSessionReadModelLoadState(
        "/repo",
        "Failed to load task session metadata",
        "task-records",
      ),
    });

    expect(state.routeSessionResolution).toEqual({
      kind: "failed",
      sessionExternalId: "session-1",
      message: "Failed to load task session metadata",
    });
    expect(state.view.sessionIdentity).toBeNull();
    expect(state.queryUpdate).toBeNull();
  });

  test("does not repair the URL while committed selection is ahead of route persistence", () => {
    const routeSession = createSession("task-1", "session-1");

    expect(
      createNavigationState({
        tasks: [createTask("task-1"), createTask("task-2")],
        sessions: [routeSession],
        taskIdParam: "task-1",
        sessionExternalIdParam: sessionExternalIdParam(routeSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "spec",
        selectionState: toAgentStudioTaskSelection("task-2"),
      }).queryUpdate,
    ).toBeNull();
  });
});

test("resolves the exact notification session when native IDs collide", () => {
  const first = createAgentSessionSummaryFixture({
    externalSessionId: "shared",
    runtimeKind: "opencode",
    workingDirectory: "/repo/first",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
  });
  const second = createAgentSessionSummaryFixture({
    externalSessionId: "shared",
    runtimeKind: "codex",
    workingDirectory: "/repo/second",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  });
  const state = createNavigationState({
    sessions: [first, second],
    taskIdParam: "task-1",
    sessionExternalIdParam: "shared",
    hasExplicitRoleParam: true,
    roleFromQuery: "build",
    selectionState: toAgentStudioSessionSelection({ ...second, taskId: "task-1", role: "build" }),
  });
  expect(state.routeSessionResolution).toEqual({ kind: "found", session: second });
  expect(state.view.sessionIdentity).toEqual({
    externalSessionId: "shared",
    runtimeKind: "codex",
    workingDirectory: "/repo/second",
  });
  expect(state.queryUpdate).toBeNull();
});

test("reports an address without identity that matches more than one session", () => {
  const first = createAgentSessionSummaryFixture({
    externalSessionId: "shared",
    runtimeKind: "opencode",
    workingDirectory: "/repo/first",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
  });
  const second = createAgentSessionSummaryFixture({
    externalSessionId: "shared",
    runtimeKind: "codex",
    workingDirectory: "/repo/second",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  });
  const state = createNavigationState({
    sessions: [first, second],
    taskIdParam: "task-1",
    sessionExternalIdParam: "shared",
  });

  expect(state.routeSessionResolution).toEqual({
    kind: "failed",
    sessionExternalId: "shared",
    message:
      'More than one session of this task has the session ID "shared". Open the session from the session list.',
  });
  expect(state.view.sessionIdentity).toBeNull();
});
