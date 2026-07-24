import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import type { AgentSessionReadPort } from "../../queries/agent-sessions";
import { createTaskChatDraftCleanup } from "./task-chat-draft-cleanup";

const session: AgentSessionRecord = {
  runtimeKind: "opencode",
  externalSessionId: "session-1",
  role: "build",
  startedAt: "2026-07-23T10:00:00.000Z",
  workingDirectory: "/repo/worktree",
  selectedModel: null,
};

const createQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const createSessionReadPort = (
  agentSessionsListForTasks: AgentSessionReadPort["agentSessionsListForTasks"] = async (
    _repoPath,
    taskIds,
  ) => taskIds.map((taskId) => ({ taskId, agentSessions: [session] })),
): AgentSessionReadPort => ({
  agentSessionsList: async () => [],
  agentSessionsListForTasks,
});

describe("createTaskChatDraftCleanup", () => {
  test("leaves drafts intact when the host mutation fails", async () => {
    const clearDraftsForTargets = mock(() => {});
    const error = mock(() => "error-toast");
    const cleanup = createTaskChatDraftCleanup({
      agentSessionReadPort: createSessionReadPort(),
      draftClearPort: { clearDraftsForTargets },
      notificationPort: { error },
    });

    await expect(
      cleanup.runMutation({
        queryClient: createQueryClient(),
        repoPath: "/repo",
        workspaceId: "workspace-1",
        taskIds: ["task-1"],
        mutation: async () => {
          throw new Error("host mutation failed");
        },
      }),
    ).rejects.toThrow("host mutation failed");

    expect(clearDraftsForTargets).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  test("reports a draft-clear failure without rolling back a successful mutation", async () => {
    const clearFailure = new Error("storage remove failed");
    const clearDraftsForTargets = mock(() => {
      throw clearFailure;
    });
    const error = mock(() => "error-toast");
    const mutation = mock(async () => ({ ok: true }));
    const cleanup = createTaskChatDraftCleanup({
      agentSessionReadPort: createSessionReadPort(),
      draftClearPort: { clearDraftsForTargets },
      notificationPort: { error },
    });

    await expect(
      cleanup.runMutation({
        queryClient: createQueryClient(),
        repoPath: "/repo",
        workspaceId: "workspace-1",
        taskIds: ["task-1"],
        mutation,
      }),
    ).resolves.toEqual({ ok: true });

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(clearDraftsForTargets).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("Task updated, but chat draft cleanup failed", {
      description: "storage remove failed",
    });
  });

  test("reports target lookup failure only after a successful host mutation", async () => {
    const lookupFailure = new Error("session lookup failed");
    const clearDraftsForTargets = mock(() => {});
    const error = mock(() => "error-toast");
    const mutation = mock(async () => ({ ok: true }));
    const cleanup = createTaskChatDraftCleanup({
      agentSessionReadPort: createSessionReadPort(async () => {
        throw lookupFailure;
      }),
      draftClearPort: { clearDraftsForTargets },
      notificationPort: { error },
    });

    await expect(
      cleanup.runMutation({
        queryClient: createQueryClient(),
        repoPath: "/repo",
        workspaceId: "workspace-1",
        taskIds: ["task-1"],
        mutation,
      }),
    ).resolves.toEqual({ ok: true });

    expect(clearDraftsForTargets).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Task updated, but chat draft cleanup failed", {
      description: "session lookup failed",
    });
  });
});
