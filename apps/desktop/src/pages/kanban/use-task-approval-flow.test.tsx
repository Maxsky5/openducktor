import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTauriHostClient } from "@openducktor/adapters-tauri-host";
import type { TaskApprovalContext } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";

enableReactActEnvironment();

const taskApprovalContextGetMock = mock(async (_repoPath: string, _taskId: string) => {
  throw new Error("not configured");
});
const taskDirectMergeMock = mock(async () => ({
  outcome: "completed" as const,
  task: createTaskCardFixture({ id: "TASK-1", status: "closed" }),
}));
const taskDirectMergeCompleteMock = mock(async () =>
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

mock.module("@/lib/open-external-url", () => ({
  openExternalUrl: async () => {},
}));

const createUnavailableHostClient = () =>
  createTauriHostClient(async () => {
    throw new Error("Tauri runtime not available. Run inside the desktop shell.");
  });

const buildMockedHost = () => ({
  ...createUnavailableHostClient(),
  taskApprovalContextGet: taskApprovalContextGetMock,
  taskDirectMerge: taskDirectMergeMock,
  taskDirectMergeComplete: taskDirectMergeCompleteMock,
  taskPullRequestUpsert: taskPullRequestUpsertMock,
  gitPushBranch: gitPushBranchMock,
  agentSessionsList: async () => [
    {
      ...createAgentSessionFixture({
        sessionId: "builder-session-old",
        taskId: "TASK-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-03-12T11:59:00Z",
      }),
    },
    {
      ...createAgentSessionFixture({
        sessionId: "builder-session",
        taskId: "TASK-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-03-12T12:00:00Z",
      }),
    },
  ],
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
});

const HOST_METHOD_NAMES = [
  "taskApprovalContextGet",
  "taskDirectMerge",
  "taskDirectMergeComplete",
  "taskPullRequestUpsert",
  "gitPushBranch",
  "agentSessionsList",
  "specGet",
  "planGet",
  "qaGetReport",
  "workspaceGetRepoConfig",
  "workspaceGetSettingsSnapshot",
] as const;

type HostMethodName = (typeof HOST_METHOD_NAMES)[number];
type HostLike = Record<HostMethodName, unknown>;

let originalHostMethods: Partial<HostLike> | null = null;

const applyHostMocks = async (): Promise<void> => {
  const hostModule = await import("@/state/operations/host");
  const hostClientModule = await import("@/lib/host-client");
  const mockedHost = buildMockedHost();
  if (!originalHostMethods) {
    originalHostMethods = Object.fromEntries(
      HOST_METHOD_NAMES.map((name) => [name, hostClientModule.hostClient[name]]),
    ) as Partial<HostLike>;
  }
  Object.assign(hostClientModule.hostClient, mockedHost);
  Object.assign(hostModule.host, mockedHost);
};

const restoreHostMocks = async (): Promise<void> => {
  if (!originalHostMethods) {
    return;
  }
  const hostModule = await import("@/state/operations/host");
  const hostClientModule = await import("@/lib/host-client");
  Object.assign(hostClientModule.hostClient, originalHostMethods);
  Object.assign(hostModule.host, originalHostMethods);
};

let latestHarnessValue: {
  taskApprovalModal: {
    open: boolean;
    stage: "approval" | "complete_direct_merge";
    isLoading: boolean;
    mode: "direct_merge" | "pull_request";
    mergeMethod: "merge_commit" | "squash" | "rebase";
    pullRequestDraftMode: "manual" | "generate_ai";
    squashCommitMessage: string;
    squashCommitMessageTouched: boolean;
    hasSuggestedSquashCommitMessage: boolean;
    hasUncommittedChanges: boolean;
    uncommittedFileCount: number;
    errorMessage: string | null;
    onOpenChange: (open: boolean) => void;
    onModeChange: (mode: "direct_merge" | "pull_request") => void;
    onMergeMethodChange: (mergeMethod: "merge_commit" | "squash" | "rebase") => void;
    onPullRequestDraftModeChange: (mode: "manual" | "generate_ai") => void;
    onSquashCommitMessageChange: (value: string) => void;
    onConfirm: () => void;
    onCompleteDirectMerge: () => void;
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
    await applyHostMocks();
    latestHarnessValue = null;
    taskApprovalContextGetMock.mockClear();
    taskDirectMergeMock.mockClear();
    taskDirectMergeCompleteMock.mockClear();
    taskPullRequestUpsertMock.mockClear();
    gitPushBranchMock.mockClear();
    toastLoadingMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
  });

  afterAll(async () => {
    await restoreHostMocks();
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
      renderer = create(
        <QueryProvider useIsolatedClient>
          <Harness />
        </QueryProvider>,
      );
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
      suggestedSquashCommitMessage: "feat: builder change",
      providers: [],
    });

    await act(async () => {
      await pendingApprovalContext.promise;
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.isLoading).toBe(false);
    expect(latestHarnessValue?.taskApprovalModal?.mergeMethod).toBe("squash");
    expect(latestHarnessValue?.taskApprovalModal?.squashCommitMessage).toBe("feat: builder change");
    expect(latestHarnessValue?.taskApprovalModal?.hasUncommittedChanges).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.uncommittedFileCount).toBe(2);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("reopens in direct merge completion stage when a local merge is already recorded", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce({
      taskId: "TASK-1",
      taskStatus: "human_review",
      workingDirectory: undefined,
      sourceBranch: "odt/TASK-1",
      targetBranch: { remote: "origin", branch: "main" },
      publishTarget: { remote: "origin", branch: "main" },
      defaultMergeMethod: "rebase",
      hasUncommittedChanges: false,
      uncommittedFileCount: 0,
      pullRequest: undefined,
      directMerge: {
        method: "rebase",
        sourceBranch: "odt/TASK-1",
        targetBranch: { remote: "origin", branch: "main" },
        mergedAt: "2026-03-12T12:00:00Z",
      },
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
      renderer = create(
        <QueryProvider useIsolatedClient>
          <Harness />
        </QueryProvider>,
      );
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.stage).toBe("complete_direct_merge");

    await act(async () => {
      renderer.unmount();
    });
  });

  test("refetches approval context on reopen so worktree status is current", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce({
      taskId: "TASK-1",
      taskStatus: "human_review",
      workingDirectory: "/repo/.worktrees/task-1",
      sourceBranch: "odt/TASK-1",
      targetBranch: { remote: "origin", branch: "main" },
      publishTarget: { remote: "origin", branch: "main" },
      defaultMergeMethod: "merge_commit",
      hasUncommittedChanges: true,
      uncommittedFileCount: 2,
      pullRequest: undefined,
      directMerge: undefined,
      providers: [],
    } satisfies TaskApprovalContext as unknown as never);
    taskApprovalContextGetMock.mockResolvedValueOnce({
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
      directMerge: undefined,
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
      renderer = create(
        <QueryProvider useIsolatedClient>
          <Harness />
        </QueryProvider>,
      );
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.hasUncommittedChanges).toBe(true);

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onOpenChange(false);
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    expect(taskApprovalContextGetMock).toHaveBeenCalledTimes(2);
    expect(latestHarnessValue?.taskApprovalModal?.hasUncommittedChanges).toBe(false);
    expect(latestHarnessValue?.taskApprovalModal?.uncommittedFileCount).toBe(0);

    await act(async () => {
      renderer.unmount();
    });
  });

  test("publishes and completes a pending direct merge", async () => {
    taskDirectMergeMock.mockResolvedValueOnce({
      outcome: "completed" as const,
      task: createTaskCardFixture({ id: "TASK-1", status: "human_review" }),
    });
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
      directMerge: undefined,
      providers: [],
    } satisfies TaskApprovalContext as unknown as never);
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
      directMerge: {
        method: "merge_commit",
        sourceBranch: "odt/TASK-1",
        targetBranch: { remote: "upstream", branch: "main" },
        mergedAt: "2026-03-12T12:00:00Z",
      },
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
      renderer = create(
        <QueryProvider useIsolatedClient>
          <Harness />
        </QueryProvider>,
      );
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onMergeMethodChange("squash");
      latestHarnessValue?.taskApprovalModal?.onSquashCommitMessageChange("feat: merged task");
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onConfirm();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.stage).toBe("complete_direct_merge");

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onCompleteDirectMerge();
      await Promise.resolve();
    });

    expect(taskDirectMergeMock).toHaveBeenCalledWith("/repo", "TASK-1", {
      mergeMethod: "squash",
      squashCommitMessage: "feat: merged task",
    });
    expect(gitPushBranchMock).toHaveBeenCalledWith("/repo", "main", {
      remote: "upstream",
    });
    expect(taskDirectMergeCompleteMock).toHaveBeenCalledWith("/repo", "TASK-1");

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
      renderer = create(
        <QueryProvider useIsolatedClient>
          <Harness />
        </QueryProvider>,
      );
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onConfirm();
      await Promise.resolve();
    });

    expect(taskDirectMergeMock).toHaveBeenCalledWith("/repo", "TASK-1", {
      mergeMethod: "merge_commit",
      squashCommitMessage: undefined,
    });
    expect(gitPushBranchMock).not.toHaveBeenCalled();
    expect(refreshTasksMock).toHaveBeenCalledTimes(1);
    expect(latestHarnessValue?.taskApprovalModal).toBeNull();

    await act(async () => {
      renderer.unmount();
    });
  });

  test("creates an AI pull request when the forked reply is already present before the waiter starts", async () => {
    const refreshTasksMock = mock(async () => {});
    const loadAgentSessionsMock = mock(async () => {});
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
      status: "running",
      startedAt: "2026-03-12T12:01:00Z",
      messages: [
        {
          id: "assistant-builder",
          role: "assistant",
          content: "Builder context",
          timestamp: "2026-03-12T12:00:00Z",
        },
      ],
    });

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        sessions: [builderSession, forkedSession],
        loadAgentSessions: loadAgentSessionsMock,
        forkAgentSession: async () => "forked-session",
        sendAgentMessage: async () => {
          forkedSession.messages.push({
            id: "assistant-forked",
            role: "assistant",
            content: "Title: PR\nDescription: Body",
            timestamp: "2026-03-12T12:02:00Z",
          });
          forkedSession.status = "stopped";
        },
        refreshTasks: refreshTasksMock,
      });
      return null;
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryProvider useIsolatedClient>
          <Harness />
        </QueryProvider>,
      );
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
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(loadAgentSessionsMock).toHaveBeenCalledWith("TASK-1", {
      hydrateHistoryForSessionId: "builder-session",
    });
    expect(taskPullRequestUpsertMock).toHaveBeenCalledWith("/repo", "TASK-1", "PR", "Body");
    expect(refreshTasksMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Pull request created",
      expect.objectContaining({
        id: "toast-id",
        description: "PR #17",
      }),
    );

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
      renderer = create(
        <QueryProvider useIsolatedClient>
          <Harness />
        </QueryProvider>,
      );
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
