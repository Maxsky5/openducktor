import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskApprovalContext } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { clearAppQueryClient } from "@/lib/query-client";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";

enableReactActEnvironment();

const taskApprovalContextGetMock = mock(async (_repoPath: string, _taskId: string) => {
  throw new Error("not configured");
});
const taskDirectMergeMock = mock(async () =>
  createTaskCardFixture({ id: "TASK-1", status: "closed" }),
);
const taskPullRequestUpsertMock = mock(async () => ({
  providerId: "github" as const,
  number: 17,
  url: "https://github.com/openai/openducktor/pull/17",
  state: "open" as const,
  createdAt: "2026-03-12T12:00:00Z",
  updatedAt: "2026-03-12T12:00:00Z",
  lastSyncedAt: undefined,
  mergedAt: undefined,
  closedAt: undefined,
}));
const gitPushBranchMock = mock(async () => ({
  outcome: "pushed" as const,
  remote: "origin",
  branch: "main",
  output: "",
}));
const toastLoadingMock = mock(() => "toast-id");
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});

mock.module("sonner", () => ({
  toast: {
    loading: toastLoadingMock,
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

mock.module("@/state/operations/host", () => ({
  host: {
    taskApprovalContextGet: taskApprovalContextGetMock,
    taskDirectMerge: taskDirectMergeMock,
    taskPullRequestUpsert: taskPullRequestUpsertMock,
    gitPushBranch: gitPushBranchMock,
    agentSessionsList: async () => [{ role: "build", sessionId: "builder-session" }],
    specGet: async () => ({ markdown: "", updatedAt: null }),
    planGet: async () => ({ markdown: "", updatedAt: null }),
    qaGetReport: async () => ({ markdown: "", updatedAt: null }),
    workspaceGetRepoConfig: async () => ({ promptOverrides: {} }),
    workspaceGetSettingsSnapshot: async () => ({
      theme: "light" as const,
      git: { defaultMergeMethod: "merge_commit" as const },
      chat: { showThinkingMessages: false },
      repos: {},
      globalPromptOverrides: {},
    }),
  },
}));

mock.module("@/lib/open-external-url", () => ({
  openExternalUrl: async () => {},
}));

let latestHarnessValue: {
  taskApprovalModal: {
    open: boolean;
    isLoading: boolean;
    mode: "direct_merge" | "pull_request";
    mergeMethod: "merge_commit" | "squash" | "rebase";
    pullRequestDraftMode: "manual" | "generate_ai";
    hasUncommittedChanges: boolean;
    uncommittedFileCount: number;
    errorMessage: string | null;
    onModeChange: (mode: "direct_merge" | "pull_request") => void;
    onPullRequestDraftModeChange: (mode: "manual" | "generate_ai") => void;
    onConfirm: () => void;
    onConfirmPush: () => void;
  } | null;
  openTaskApproval: (taskId: string) => void;
} | null = null;

function createDeferred<TValue>() {
  let resolvePromise!: (value: TValue) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<TValue>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

describe("useTaskApprovalFlow", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
    latestHarnessValue = null;
    taskApprovalContextGetMock.mockClear();
    taskDirectMergeMock.mockClear();
    taskPullRequestUpsertMock.mockClear();
    gitPushBranchMock.mockClear();
    toastLoadingMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  test("opens immediately in loading state and does not fetch the settings snapshot", async () => {
    const pendingApprovalContext = createDeferred<TaskApprovalContext>();
    taskApprovalContextGetMock.mockImplementationOnce(
      (async () => pendingApprovalContext.promise) as unknown as never,
    );

    const { useTaskApprovalFlow } = await import("./use-task-approval-flow");

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [
          createTaskCardFixture({
            id: "TASK-1",
            title: "Ship approval flow",
            description: "Task description",
          }),
        ],
        sessions: [],
        loadAgentSessions: async () => {},
        forkAgentSession: async () => "forked-session",
        sendAgentMessage: async () => {},
        refreshTasks: async () => {},
      });
      return null;
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Harness />);
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
    });

    expect(taskApprovalContextGetMock).toHaveBeenCalledWith("/repo", "TASK-1");
    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.isLoading).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.mergeMethod).toBe("merge_commit");

    pendingApprovalContext.resolve({
      taskId: "TASK-1",
      taskStatus: "human_review",
      workingDirectory: "/repo/.worktrees/task-1",
      sourceBranch: "odt/TASK-1",
      targetBranch: { remote: "origin", branch: "main" },
      publishTarget: { remote: "origin", branch: "main" },
      defaultMergeMethod: "squash",
      hasUncommittedChanges: true,
      uncommittedFileCount: 2,
      pullRequest: undefined,
      providers: [],
    });

    await act(async () => {
      await pendingApprovalContext.promise;
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.isLoading).toBe(false);
    expect(latestHarnessValue?.taskApprovalModal?.mergeMethod).toBe("squash");
    expect(latestHarnessValue?.taskApprovalModal?.hasUncommittedChanges).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.uncommittedFileCount).toBe(2);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("pushes the merged target branch to the target remote", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce({
      taskId: "TASK-1",
      taskStatus: "human_review",
      workingDirectory: "/repo/.worktrees/task-1",
      sourceBranch: "odt/TASK-1",
      targetBranch: { remote: "upstream", branch: "main" },
      publishTarget: { remote: "upstream", branch: "main" },
      defaultMergeMethod: "merge_commit",
      hasUncommittedChanges: false,
      uncommittedFileCount: 0,
      pullRequest: undefined,
      providers: [],
    } satisfies TaskApprovalContext as unknown as never);

    const { useTaskApprovalFlow } = await import("./use-task-approval-flow");

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        sessions: [],
        loadAgentSessions: async () => {},
        forkAgentSession: async () => "forked-session",
        sendAgentMessage: async () => {},
        refreshTasks: async () => {},
      });
      return null;
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Harness />);
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onConfirm();
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onConfirmPush();
      await Promise.resolve();
    });

    expect(taskDirectMergeMock).toHaveBeenCalledWith("/repo", "TASK-1", "merge_commit");
    expect(gitPushBranchMock).toHaveBeenCalledWith("/repo", "main", {
      remote: "upstream",
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  test("closes after direct merge without offering a push step for local-only target branches", async () => {
    const refreshTasksMock = mock(async () => {});
    taskApprovalContextGetMock.mockResolvedValueOnce({
      taskId: "TASK-1",
      taskStatus: "human_review",
      workingDirectory: "/repo/.worktrees/task-1",
      sourceBranch: "odt/TASK-1",
      targetBranch: { branch: "release/2026.03" },
      publishTarget: undefined,
      defaultMergeMethod: "merge_commit",
      hasUncommittedChanges: false,
      uncommittedFileCount: 0,
      pullRequest: undefined,
      providers: [],
    } satisfies TaskApprovalContext as unknown as never);

    const { useTaskApprovalFlow } = await import("./use-task-approval-flow");

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        sessions: [],
        loadAgentSessions: async () => {},
        forkAgentSession: async () => "forked-session",
        sendAgentMessage: async () => {},
        refreshTasks: refreshTasksMock,
      });
      return null;
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Harness />);
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onConfirm();
      await Promise.resolve();
    });

    expect(taskDirectMergeMock).toHaveBeenCalledWith("/repo", "TASK-1", "merge_commit");
    expect(gitPushBranchMock).not.toHaveBeenCalled();
    expect(refreshTasksMock).toHaveBeenCalledTimes(1);
    expect(latestHarnessValue?.taskApprovalModal).toBeNull();

    await act(async () => {
      renderer.unmount();
    });
  });

  test("closes the modal and shows a reopenable error toast while AI pull request generation runs in background", async () => {
    taskApprovalContextGetMock.mockResolvedValue({
      taskId: "TASK-1",
      taskStatus: "human_review",
      workingDirectory: "/repo/.worktrees/task-1",
      sourceBranch: "odt/TASK-1",
      targetBranch: { remote: "origin", branch: "main" },
      publishTarget: { remote: "origin", branch: "main" },
      defaultMergeMethod: "merge_commit",
      hasUncommittedChanges: false,
      uncommittedFileCount: 0,
      pullRequest: undefined,
      providers: [
        {
          providerId: "github",
          enabled: true,
          available: true,
          reason: undefined,
        },
      ],
    } satisfies TaskApprovalContext as unknown as never);
    taskPullRequestUpsertMock.mockRejectedValueOnce(new Error("Generation crashed"));

    const { useTaskApprovalFlow } = await import("./use-task-approval-flow");
    const builderSession = createAgentSessionFixture({
      sessionId: "builder-session",
      taskId: "TASK-1",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
      startedAt: "2026-03-12T12:00:00Z",
      messages: [
        {
          id: "assistant-builder",
          role: "assistant",
          content: "Builder context",
          timestamp: "2026-03-12T12:00:00Z",
        },
      ],
    });
    const forkedSession = createAgentSessionFixture({
      sessionId: "forked-session",
      taskId: "TASK-1",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
      startedAt: "2026-03-12T12:01:00Z",
      messages: [],
    });

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        sessions: [builderSession, forkedSession],
        loadAgentSessions: async () => {},
        forkAgentSession: async () => "forked-session",
        sendAgentMessage: async () => {
          setTimeout(() => {
            forkedSession.messages.push({
              id: "assistant-forked",
              role: "assistant",
              content: "Title: PR\nDescription: Body",
              timestamp: "2026-03-12T12:02:00Z",
            });
          }, 0);
        },
        refreshTasks: async () => {},
      });
      return null;
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Harness />);
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onModeChange("pull_request");
      latestHarnessValue?.taskApprovalModal?.onPullRequestDraftModeChange("generate_ai");
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onConfirm();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal).toBeNull();
    expect(toastLoadingMock).toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650));
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Pull request generation failed",
      expect.objectContaining({
        description: "Generation crashed",
        action: expect.objectContaining({ label: "Reopen" }),
      }),
    );

    const firstErrorToastCall = toastErrorMock.mock.calls[0] as unknown[] | undefined;
    const errorToastOptions = firstErrorToastCall?.[1] as {
      action?: { onClick: () => void };
    };
    expect(errorToastOptions.action).toBeDefined();

    await act(async () => {
      errorToastOptions.action?.onClick();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.mode).toBe("pull_request");
    expect(latestHarnessValue?.taskApprovalModal?.errorMessage).toBe("Generation crashed");

    await act(async () => {
      renderer.unmount();
    });
  });
});
