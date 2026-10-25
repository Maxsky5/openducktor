import "../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { TaskWorktreeSummary } from "@openducktor/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { createTestClientConnection } from "../test-support/test-client-connection";
import {
  workspaceSessionRecord,
  worktreeExecutionTarget,
} from "../test-support/workspace-session-fixtures";
import { useTaskTerminalScope, workspaceSessionTerminalScope } from "./terminal-scopes";

const chatScope = (record: ReturnType<typeof workspaceSessionRecord>) =>
  workspaceSessionTerminalScope({
    key: "chat",
    workspaceId: "ws-1",
    repoPath: "/repos/alpha",
    record,
  });

describe("workspaceSessionTerminalScope", () => {
  test("starts chat terminals in the saved chat directory", () => {
    expect(chatScope(workspaceSessionRecord("chat-1"))).toEqual({
      key: "chat",
      context: {
        kind: "workspace_session",
        workspaceId: "ws-1",
        sessionId: "chat-1",
        repoPath: "/repos/alpha",
      },
      workingDirectory: "/repos/alpha",
      workingDirectoryError: "This chat has no saved directory. Reopen or restore the chat.",
    });
  });

  test("blocks archived chats and chats with a removed worktree", () => {
    expect(chatScope(workspaceSessionRecord("chat-1", { archivedAt: 5 }))).toMatchObject({
      workingDirectory: null,
      workingDirectoryError: "This chat is archived. Restore the chat to use terminals.",
    });
    const removed = workspaceSessionRecord("chat-1", {
      executionTarget: worktreeExecutionTarget({ worktreeState: "removed" }),
    });
    expect(chatScope(removed)).toMatchObject({
      workingDirectory: null,
      workingDirectoryError:
        "The worktree of this chat was removed. Restore the chat to create the worktree again.",
    });
  });
});

describe("useTaskTerminalScope", () => {
  test("starts task terminals in the task worktree", async () => {
    const worktree: TaskWorktreeSummary = { workingDirectory: "/worktrees/task-1" };
    const connection = createTestClientConnection({
      client: { taskWorktreeGet: async () => worktree },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(ClientConnectionProvider, { connection }, children);
    const view = renderHook(
      () =>
        useTaskTerminalScope({
          key: "task",
          repoPath: "/repo",
          taskId: "task-1",
          taskVersion: "1",
        }),
      { wrapper },
    );
    expect(view.result.current.scope?.workingDirectory).toBeNull();
    await waitFor(() =>
      expect(view.result.current.scope).toEqual({
        key: "task",
        context: { repoPath: "/repo", taskId: "task-1" },
        workingDirectory: "/worktrees/task-1",
        workingDirectoryError: "Task task-1 has no available worktree.",
      }),
    );
    expect(view.result.current.isScopeLoading).toBe(false);
    view.unmount();
  });

  test("has no scope without a task", () => {
    const connection = createTestClientConnection();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(ClientConnectionProvider, { connection }, children);
    const view = renderHook(
      () => useTaskTerminalScope({ key: null, repoPath: "/repo", taskId: null, taskVersion: null }),
      { wrapper },
    );
    expect(view.result.current.scope).toBeNull();
    expect(view.result.current.isScopeLoading).toBe(false);
    expect(view.result.current.scopeError).toBeNull();
    view.unmount();
  });

  test("shows a failed worktree read and reads the worktree again on retry", async () => {
    const reads: string[] = [];
    let failRead = true;
    const connection = createTestClientConnection({
      client: {
        taskWorktreeGet: async (_repoPath, taskId) => {
          reads.push(taskId);
          if (failRead) throw new Error("The host is offline.");
          return { workingDirectory: "/worktrees/task-1" };
        },
      },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(ClientConnectionProvider, { connection }, children);
    const view = renderHook(
      () =>
        useTaskTerminalScope({
          key: "task",
          repoPath: "/repo",
          taskId: "task-1",
          taskVersion: "1",
        }),
      { wrapper },
    );
    const readError = "Could not read the worktree of task task-1: The host is offline.";
    await waitFor(() => expect(view.result.current.scopeError).toBe(readError));
    expect(view.result.current.scope?.workingDirectory).toBeNull();
    expect(view.result.current.scope?.workingDirectoryError).toBe(readError);
    expect(view.result.current.isScopeLoading).toBe(false);

    failRead = false;
    act(() => view.result.current.retryScope());

    await waitFor(() =>
      expect(view.result.current.scope?.workingDirectory).toBe("/worktrees/task-1"),
    );
    expect(view.result.current.scopeError).toBeNull();
    expect(reads).toEqual(["task-1", "task-1"]);
    view.unmount();
  });
});
