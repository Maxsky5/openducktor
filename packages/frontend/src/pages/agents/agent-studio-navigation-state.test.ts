import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import { resolveAgentStudioNavigationState } from "./agent-studio-navigation-state";
import { createAgentSessionSummaryFixture, createTaskCardFixture } from "./agent-studio-test-utils";
import {
  createAgentStudioRouteSelectionState,
  toAgentStudioTaskSelection,
} from "./shell/agent-studio-selection-state";

const createTask = (id: string) => createTaskCardFixture({ id, title: id });

const createSession = (taskId: string, externalSessionId: string) =>
  createAgentSessionSummaryFixture({
    externalSessionId: `ext-${externalSessionId}`,
    taskId,
  });

const sessionKeyParam = (session: ReturnType<typeof createAgentSessionSummaryFixture>): string =>
  agentSessionIdentityKey(session);

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
    sessionKeyParam: null,
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
        sessionKeyParam: base.sessionKeyParam,
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

  test("backfills missing task param from selected session", () => {
    const selectedSession = createSession("task-2", "session-2");

    expect(
      createNavigationState({
        tasks: [createTask("task-1"), createTask("task-2")],
        sessions: [selectedSession],
        taskIdParam: "",
        sessionKeyParam: sessionKeyParam(selectedSession),
      }).queryUpdate,
    ).toEqual({ task: "task-2" });
  });

  test("does not clear a session deep link before the session catalog can resolve it", () => {
    expect(
      createNavigationState({
        tasks: [createTask("task-1")],
        taskIdParam: "missing-task",
        sessionKeyParam: "session-2",
        sessionReadModelLoadState: loadingAgentSessionReadModelLoadState("/repo"),
      }).queryUpdate,
    ).toBeNull();
  });

  test("clears stale session selection for an existing reset task", () => {
    expect(
      createNavigationState({
        tasks: [createTask("task-1")],
        taskIdParam: "task-1",
        sessionKeyParam: "removed-session",
      }).queryUpdate,
    ).toEqual({ session: undefined });
  });

  test("corrects the task when a resolved session belongs to another task", () => {
    const selectedSession = createSession("task-2", "session-2");

    expect(
      createNavigationState({
        tasks: [createTask("task-1"), createTask("task-2")],
        sessions: [selectedSession],
        taskIdParam: "task-1",
        sessionKeyParam: sessionKeyParam(selectedSession),
      }).queryUpdate,
    ).toEqual({ task: "task-2" });
  });

  test("aligns missing task and stale role in one query update", () => {
    const resolvedSession = createAgentSessionSummaryFixture({
      runtimeKind: "opencode",
      externalSessionId: "ext-session-1",
      taskId: "task-1",
      role: "planner",
    });

    expect(
      createNavigationState({
        taskIdParam: "",
        sessionKeyParam: sessionKeyParam(resolvedSession),
        sessions: [resolvedSession],
        roleFromQuery: "spec",
      }).queryUpdate,
    ).toEqual({
      task: "task-1",
      agent: "planner",
    });
  });

  test("does not repair the URL while local tab selection is ahead of route persistence", () => {
    const routeSession = createSession("task-1", "session-1");

    expect(
      createNavigationState({
        tasks: [createTask("task-1"), createTask("task-2")],
        sessions: [routeSession],
        taskIdParam: "task-1",
        sessionKeyParam: sessionKeyParam(routeSession),
        hasExplicitRoleParam: true,
        roleFromQuery: "spec",
        selectionState: toAgentStudioTaskSelection("task-2"),
      }).queryUpdate,
    ).toBeNull();
  });
});
