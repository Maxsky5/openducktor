import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTauriHostClient } from "@openducktor/adapters-tauri-host";
import type { TaskApprovalContext } from "@openducktor/contracts";
import { waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { act } from "react";
import { toast } from "sonner";
import { clearAppQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";
import { useTaskApprovalFlow } from "./use-task-approval-flow";

enableReactActEnvironment();

const defaultTaskApprovalContextGet = async (_repoPath: string, _taskId: string) => {
  throw new Error("not configured");
};
const defaultTaskDirectMerge = async () => ({
  outcome: "completed" as const,
  task: createTaskCardFixture({ id: "TASK-1", status: "closed" }),
});
const defaultTaskDirectMergeComplete = async () =>
  createTaskCardFixture({ id: "TASK-1", status: "closed" });
const defaultTaskPullRequestUpsert = async () => ({
  providerId: "github" as const,
  number: 17,
  url: "https://github.com/openai/openducktor/pull/17",
  state: "open" as const,
  createdAt: "2026-03-12T12:00:00Z",
  updatedAt: "2026-03-12T12:00:00Z",
  lastSyncedAt: undefined,
  mergedAt: undefined,
  closedAt: undefined,
});
const defaultGitPushBranch = async () => ({
  outcome: "pushed" as const,
  remote: "origin",
  branch: "main",
  output: "",
});

const taskApprovalContextGetMock = mock(defaultTaskApprovalContextGet);
const taskDirectMergeMock = mock(defaultTaskDirectMerge);
const taskDirectMergeCompleteMock = mock(defaultTaskDirectMergeComplete);
const taskPullRequestUpsertMock = mock(defaultTaskPullRequestUpsert);
const gitPushBranchMock = mock(defaultGitPushBranch);
const toastLoadingMock = mock(() => "toast-id");
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});
const originalToastLoading = toast.loading;
const originalToastSuccess = toast.success;
const originalToastError = toast.error;

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
    pullRequestAvailable: boolean;
    pullRequestUnavailableReason: string | null;
    isSubmitting: boolean;
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

const mountApprovalHarness = async (Harness: () => ReactElement | null) => {
  const harness = createSharedHookHarness(Harness, undefined, {
    wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider>,
  });
  await harness.mount();
  return harness;
};

const waitForTaskApprovalModalLoaded = async (timeoutMs = 1000): Promise<void> => {
  await waitFor(
    () => {
      expect(latestHarnessValue?.taskApprovalModal).toBeTruthy();
      expect(latestHarnessValue?.taskApprovalModal?.isLoading).toBe(false);
    },
    { timeout: timeoutMs },
  );
};

const waitForTaskApprovalModalClosed = async (timeoutMs = 1000): Promise<void> => {
  await waitFor(
    () => {
      expect(latestHarnessValue?.taskApprovalModal).toBeNull();
    },
    { timeout: timeoutMs },
  );
};

describe("useTaskApprovalFlow", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
    await applyHostMocks();
    latestHarnessValue = null;
    (toast as { loading: typeof toast.loading }).loading =
      toastLoadingMock as unknown as typeof toast.loading;
    (toast as { success: typeof toast.success }).success =
      toastSuccessMock as unknown as typeof toast.success;
    (toast as { error: typeof toast.error }).error =
      toastErrorMock as unknown as typeof toast.error;
    toastLoadingMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
    taskApprovalContextGetMock.mockClear();
    taskApprovalContextGetMock.mockImplementation(defaultTaskApprovalContextGet);
    taskDirectMergeMock.mockClear();
    taskDirectMergeMock.mockImplementation(defaultTaskDirectMerge);
    taskDirectMergeCompleteMock.mockClear();
    taskDirectMergeCompleteMock.mockImplementation(defaultTaskDirectMergeComplete);
    taskPullRequestUpsertMock.mockClear();
    taskPullRequestUpsertMock.mockImplementation(defaultTaskPullRequestUpsert);
    gitPushBranchMock.mockClear();
    gitPushBranchMock.mockImplementation(defaultGitPushBranch);
  });

  afterAll(async () => {
    await restoreHostMocks();
    (toast as { loading: typeof toast.loading }).loading = originalToastLoading;
    (toast as { success: typeof toast.success }).success = originalToastSuccess;
    (toast as { error: typeof toast.error }).error = originalToastError;
  });

  test("opens immediately in loading state and does not fetch the settings snapshot", async () => {
    const pendingApprovalContext = createDeferred<TaskApprovalContext>();
    taskApprovalContextGetMock.mockImplementationOnce(
      (async () => pendingApprovalContext.promise) as unknown as never,
    );

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
        requestPullRequestGeneration: async () => undefined,
        refreshTasks: async () => {},
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

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
      await harness.unmount();
    });
  });

  test("defaults to pull_request mode when GitHub provider is available", async () => {
    const pendingApprovalContext = createDeferred<TaskApprovalContext>();
    taskApprovalContextGetMock.mockImplementationOnce(
      (async () => pendingApprovalContext.promise) as unknown as never,
    );

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
        requestPullRequestGeneration: async () => undefined,
        refreshTasks: async () => {},
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
    });

    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.isLoading).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.mode).toBe("direct_merge");

    pendingApprovalContext.resolve({
      taskId: "TASK-1",
      taskStatus: "human_review",
      workingDirectory: "/repo/.worktrees/task-1",
      sourceBranch: "odt/TASK-1",
      targetBranch: { remote: "origin", branch: "main" },
      publishTarget: undefined,
      defaultMergeMethod: "merge_commit",
      hasUncommittedChanges: false,
      uncommittedFileCount: 0,
      pullRequest: undefined,
      suggestedSquashCommitMessage: undefined,
      providers: [
        {
          providerId: "github",
          enabled: true,
          available: true,
          reason: undefined,
        },
      ],
    });

    await act(async () => {
      await pendingApprovalContext.promise;
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.isLoading).toBe(false);
    expect(latestHarnessValue?.taskApprovalModal?.mode).toBe("pull_request");
    expect(latestHarnessValue?.taskApprovalModal?.pullRequestAvailable).toBe(true);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("defaults to direct_merge mode when no git provider is available", async () => {
    const pendingApprovalContext = createDeferred<TaskApprovalContext>();
    taskApprovalContextGetMock.mockImplementationOnce(
      (async () => pendingApprovalContext.promise) as unknown as never,
    );

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
        requestPullRequestGeneration: async () => undefined,
        refreshTasks: async () => {},
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
    });

    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.isLoading).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.mode).toBe("direct_merge");

    pendingApprovalContext.resolve({
      taskId: "TASK-1",
      taskStatus: "human_review",
      workingDirectory: "/repo/.worktrees/task-1",
      sourceBranch: "odt/TASK-1",
      targetBranch: { remote: "origin", branch: "main" },
      publishTarget: undefined,
      defaultMergeMethod: "merge_commit",
      hasUncommittedChanges: false,
      uncommittedFileCount: 0,
      pullRequest: undefined,
      suggestedSquashCommitMessage: undefined,
      providers: [],
    });

    await act(async () => {
      await pendingApprovalContext.promise;
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.isLoading).toBe(false);
    expect(latestHarnessValue?.taskApprovalModal?.mode).toBe("direct_merge");
    expect(latestHarnessValue?.taskApprovalModal?.pullRequestAvailable).toBe(false);

    await act(async () => {
      await harness.unmount();
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

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        requestPullRequestGeneration: async () => undefined,
        refreshTasks: async () => {},
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.stage).toBe("complete_direct_merge");

    await act(async () => {
      await harness.unmount();
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

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        requestPullRequestGeneration: async () => undefined,
        refreshTasks: async () => {},
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

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
      await harness.unmount();
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

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        requestPullRequestGeneration: async () => undefined,
        refreshTasks: async () => {},
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

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
      await harness.unmount();
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

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        requestPullRequestGeneration: async () => undefined,
        refreshTasks: refreshTasksMock,
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

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
    expect(taskDirectMergeCompleteMock).not.toHaveBeenCalled();
    await waitForTaskApprovalModalClosed();
    expect(latestHarnessValue?.taskApprovalModal).toBeNull();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("closes the approval modal only after AI pull request generation starts a builder session", async () => {
    const refreshTasksMock = mock(async () => {});
    const requestPullRequestGenerationDeferred = createDeferred<string | undefined>();
    const requestPullRequestGenerationMock = mock(
      async () => requestPullRequestGenerationDeferred.promise,
    );
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

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        requestPullRequestGeneration: requestPullRequestGenerationMock,
        refreshTasks: refreshTasksMock,
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onModeChange("pull_request");
      latestHarnessValue?.taskApprovalModal?.onPullRequestDraftModeChange("generate_ai");
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onConfirm();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.isSubmitting).toBe(true);
    expect(requestPullRequestGenerationMock).toHaveBeenCalledWith("TASK-1");
    expect(taskPullRequestUpsertMock).not.toHaveBeenCalled();
    expect(refreshTasksMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();

    requestPullRequestGenerationDeferred.resolve("builder-session-pr");

    await act(async () => {
      await requestPullRequestGenerationDeferred.promise;
      await Promise.resolve();
    });
    expect(latestHarnessValue?.taskApprovalModal).toBeNull();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("keeps the approval modal open when AI pull request generation is cancelled", async () => {
    const requestPullRequestGenerationMock = mock(async () => undefined);
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

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        requestPullRequestGeneration: requestPullRequestGenerationMock,
        refreshTasks: async () => {},
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

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

    expect(requestPullRequestGenerationMock).toHaveBeenCalledWith("TASK-1");
    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.isSubmitting).toBe(false);
    expect(latestHarnessValue?.taskApprovalModal?.mode).toBe("pull_request");
    expect(latestHarnessValue?.taskApprovalModal?.errorMessage).toBeNull();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(taskPullRequestUpsertMock).not.toHaveBeenCalled();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("keeps the modal open when pull request generation cannot start", async () => {
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
    const requestPullRequestGenerationMock = mock(async () => {
      throw new Error("Generation crashed");
    });

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow({
        activeRepo: "/repo",
        tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
        requestPullRequestGeneration: requestPullRequestGenerationMock,
        refreshTasks: async () => {},
      });
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onModeChange("pull_request");
      latestHarnessValue?.taskApprovalModal?.onPullRequestDraftModeChange("generate_ai");
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onConfirm();
      await Promise.resolve();
    });

    expect(requestPullRequestGenerationMock).toHaveBeenCalledTimes(1);
    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.isSubmitting).toBe(false);
    expect(latestHarnessValue?.taskApprovalModal?.mode).toBe("pull_request");
    expect(latestHarnessValue?.taskApprovalModal?.errorMessage).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Approval failed",
      expect.objectContaining({ description: "Generation crashed" }),
    );
    expect(taskPullRequestUpsertMock).not.toHaveBeenCalled();

    await act(async () => {
      await harness.unmount();
    });
  });
});
