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
    taskId,
  });

const sessionExternalIdParam = (
  session: ReturnType<typeof createAgentSessionSummaryFixture>,
): string => session.externalSessionId;

const createNavigationState = (
  overrides: Partial<Parameters<typeof resolveAgentStudioNavigationState>[0]> = {},
) => {
  const base = {
    isRepoNavigationBoundaryPending: false,
    isLoadingTasks: false,
    sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo"),
    tasks: [createTask("task-1")],
    sessions: [],
    taskIdParam: "task-1",
    sessionExternalIdParam: null,
    hasExplicitRoleParam: false,
    roleFromQuery: "spec" as const,
    activeTaskTabId: "",
    ...overrides,
  };
  return resolveAgentStudioNavigationState({
    ...base,
    selectionState:
      overrides.selectionState ??
      createAgentStudioRouteSelectionState({
        isRepoNavigationBoundaryPending: base.isRepoNavigationBoundaryPending,
        taskIdParam: base.taskIdParam,
        sessionExternalIdParam: base.sessionExternalIdParam,
        hasExplicitRoleParam: base.hasExplicitRoleParam,
        roleFromQuery: base.roleFromQuery,
      }),
  });
};

describe("resolveAgentStudioNavigationState", () => {
  test("clears query when URL task no longer exists", () => {
    expect(
      createNavigationState({
        tasks: [createTask("task-1")],
        taskIdParam: "missing-task",
      }).queryUpdate,
    ).toEqual({
      task: undefined,
      session: undefined,
      agent: undefined,
    });
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

  test("keeps a matching session pending until task session metadata is ready", () => {
    const session = createSession("task-1", "session-1");
    const state = createNavigationState({
      sessions: [session],
      sessionExternalIdParam: session.externalSessionId,
      sessionReadModelLoadState: loadingAgentSessionReadModelLoadState("/repo"),
    });

    expect(state.routeSessionResolution).toEqual({
      kind: "pending",
      sessionExternalId: session.externalSessionId,
    });
    expect(state.view.sessionIdentity).toBeNull();
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
      taskId: "task-1",
      role: "planner",
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

  test("derives full runtime identity from the matching task session summary", () => {
    const resolvedSession = createAgentSessionSummaryFixture({
      runtimeKind: "codex",
      externalSessionId: "session-1",
      taskId: "task-1",
      role: "build",
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
      runtimeKind: "codex",
      workingDirectory: "/repo/worktrees/authoritative",
    });
  });

  test("surfaces session read-model failure for an explicit session", () => {
    const state = createNavigationState({
      taskIdParam: "task-1",
      sessionExternalIdParam: "session-1",
      sessionReadModelLoadState: failedAgentSessionReadModelLoadState(
        "/repo",
        "Failed to load task session metadata",
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

  test("does not repair the URL while local tab selection is ahead of route persistence", () => {
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
