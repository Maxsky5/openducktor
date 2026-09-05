import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord, NotificationNavigationTarget } from "@openducktor/contracts";
import {
  addNotificationAttention,
  findNotificationAttentionTarget,
  matchesNotificationSession,
  navigateToNotificationTarget,
} from "./notification-navigation-logic";
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
  test("matches a task-scoped session by its external ID", () => {
    expect(matchesNotificationSession(session, target)).toBe(true);
    expect(
      matchesNotificationSession(session, {
        ...target,
        session: {
          externalSessionId: "session-other",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree",
        },
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

  test("reports a taskless session target without routing to Agent Studio", async () => {
    const calls: string[] = [];
    const navigate = mock(() => calls.push("navigate"));
    const selectWorkspace = mock(async () => {
      calls.push("select-workspace");
    });
    const loadTasks = mock(async () => []);
    const reportStale = mock((message: string) => {
      calls.push("report-stale");
      expect(message).toBe("Repository session notifications cannot be opened yet.");
    });

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
        reportStale,
      },
    );

    expect(calls).toEqual(["select-workspace", "report-stale"]);
    expect(loadTasks).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
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
});

test("rejects a matching native ID from a different runtime or worktree", () => {
  expect(matchesNotificationSession({ ...session, runtimeKind: "opencode" }, target)).toBe(false);
  expect(matchesNotificationSession({ ...session, workingDirectory: "/other" }, target)).toBe(
    false,
  );
});

test("passes the exact session identity through transient navigation state", async () => {
  const navigate = mock(() => {});
  await navigateToNotificationTarget(target, {
    activeWorkspaceId: "workspace",
    workspaces: [{ workspaceId: "workspace", repoPath: "/repo" }],
    selectWorkspace: async () => {},
    loadTasks: async () => [createTaskCardFixture({ id: "task-1" })],
    loadTaskSessions: async () => [{ ...session, runtimeKind: "opencode" }, session],
    navigate,
    reportStale: () => {
      throw new Error("unexpected stale target");
    },
  });
  expect(navigate).toHaveBeenCalledWith(
    "/agents?task=task-1&session=session-1&agent=build&attention=permission&attentionId=request-1",
    { state: { notificationTarget: target } },
  );
});

test.each(["workspace", "tasks", "sessions"])(
  "reports %s read failures without rejecting the click",
  async (stage) => {
    const { openNotificationTarget } = await import("./notification-navigation-logic");
    const reportFailure = mock(() => {});
    const navigate = mock(() => {});
    const fail = async () => {
      throw new Error("Host unavailable");
    };
    await expect(
      openNotificationTarget(
        target,
        {
          activeWorkspaceId: null,
          workspaces: [{ workspaceId: "workspace", repoPath: "/repo" }],
          selectWorkspace: stage === "workspace" ? fail : async () => {},
          loadTasks:
            stage === "tasks" ? fail : async () => [createTaskCardFixture({ id: "task-1" })],
          loadTaskSessions: stage === "sessions" ? fail : async () => [session],
          navigate,
          reportStale: () => {},
        },
        reportFailure,
      ),
    ).resolves.toBeUndefined();
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  },
);
