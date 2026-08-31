import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, NotificationNavigationTarget } from "@openducktor/contracts";
import {
  addNotificationAttention,
  findNotificationAttentionTarget,
  matchesNotificationSession,
  navigateToNotificationTarget,
} from "./notification-navigation-logic";
import { notificationSessionIdentityFromNavigationState } from "./notification-navigation-state";
import type { NotificationSessionNavigationState } from "./notification-navigation-state";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";

const session: AgentSessionRecord = {
  externalSessionId: "session-1",
  role: "build",
  startedAt: "2026-08-31T10:00:00.000Z",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  selectedModel: null,
};

const target: Extract<NotificationNavigationTarget, { type: "pending_input" }> = {
  type: "pending_input",
  repoPath: "/repo",
  taskId: "task-1",
  session: {
    externalSessionId: "session-1",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktree",
  },
  inputKind: "permission",
  requestId: "request-1",
};

describe("notification navigation", () => {
  test("requires the full session identity", () => {
    expect(matchesNotificationSession(session, target)).toBe(true);
    expect(
      matchesNotificationSession(session, {
        ...target,
        session: { ...target.session, runtimeKind: "opencode" },
      }),
    ).toBe(false);
    expect(
      matchesNotificationSession(session, {
        ...target,
        session: { ...target.session, workingDirectory: "/repo/other" },
      }),
    ).toBe(false);
  });

  test("adds only transient attention keys to the Agent Studio URL", () => {
    const href = addNotificationAttention(
      "/agents?task=task-1&session=session-1&agent=build",
      target,
    );
    expect(href).toBe(
      "/agents?task=task-1&session=session-1&agent=build&attention=permission&attentionId=request-1",
    );
    expect(href).not.toContain("runtimeKind");
    expect(href).not.toContain("workingDirectory");
  });

  test("opens a repository session by its full identity after selecting its workspace", async () => {
    const calls: string[] = [];
    const navigate = mock((href: string, options?: { state?: unknown }) => {
      calls.push("navigate");
      expect(href).toBe("/agents?session=session-1");
      expect(options).toEqual({
        state: {
          notificationSession: {
            externalSessionId: "session-1",
            runtimeKind: "codex",
            workingDirectory: "/repo/worktree",
          },
        },
      });
    });
    const selectWorkspace = mock(async () => {
      calls.push("select-workspace");
    });
    const loadTasks = mock(async () => []);

    await navigateToNotificationTarget(
      {
        type: "agent_session",
        repoPath: "/repo",
        session: target.session,
      },
      {
        activeWorkspaceId: "workspace-other",
        workspaces: [{ workspaceId: "workspace-repo", repoPath: "/repo" }],
        selectWorkspace,
        loadTasks,
        loadTaskSessions: mock(async () => []),
        navigate,
        reportStale: mock(() => {}),
      },
    );

    expect(calls).toEqual(["select-workspace", "navigate"]);
    expect(loadTasks).not.toHaveBeenCalled();
  });

  test("loads task data while workspace selection is pending", async () => {
    let finishSelection: (() => void) | undefined;
    const selectWorkspace = mock(
      () =>
        new Promise<void>((resolve) => {
          finishSelection = resolve;
        }),
    );
    const loadTasks = mock(async () => [
      createTaskCardFixture({ id: "task-1", status: "ready_for_dev" }),
    ]);
    const navigate = mock(() => {});

    const navigation = navigateToNotificationTarget(
      {
        type: "agent_studio_task",
        repoPath: "/repo",
        taskId: "task-1",
        preferredRole: "build",
      },
      {
        activeWorkspaceId: "workspace-other",
        workspaces: [{ workspaceId: "workspace-repo", repoPath: "/repo" }],
        selectWorkspace,
        loadTasks,
        loadTaskSessions: mock(async () => []),
        navigate,
        reportStale: mock(() => {}),
      },
    );

    await Promise.resolve();
    expect(selectWorkspace).toHaveBeenCalledWith("workspace-repo");
    expect(loadTasks).toHaveBeenCalledWith("/repo");
    expect(navigate).not.toHaveBeenCalled();

    finishSelection?.();
    await navigation;

    expect(navigate).toHaveBeenCalledWith("/agents?task=task-1&agent=build");
  });

  test("matches only the requested error episode", () => {
    document.body.innerHTML = `
      <article data-notification-attention-kind="error" data-notification-attention-id="error-1"></article>
      <article data-notification-attention-kind="error" data-notification-attention-id="error-2"></article>
      <div data-notification-attention-kind="error"></div>
    `;

    expect(
      findNotificationAttentionTarget("error", "error-2")?.dataset.notificationAttentionId,
    ).toBe("error-2");
    expect(findNotificationAttentionTarget("error", "missing")).toBeNull();
  });

  test("accepts navigation state only for the routed external session", () => {
    const state = { notificationSession: target.session };
    expect(notificationSessionIdentityFromNavigationState(state, "session-1")).toEqual(
      target.session,
    );
    expect(notificationSessionIdentityFromNavigationState(state, "session-other")).toBeNull();
    // SAFETY: Deliberately forge malformed browser history state to verify boundary validation.
    expect(
      notificationSessionIdentityFromNavigationState(
        { notificationSession: {} } as NotificationSessionNavigationState,
        "session-1",
      ),
    ).toBeNull();
  });
});
