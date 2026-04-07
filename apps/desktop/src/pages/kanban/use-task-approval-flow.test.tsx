import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTauriHostClient } from "@openducktor/adapters-tauri-host";
import type { TaskApprovalContext, TaskApprovalContextLoadResult } from "@openducktor/contracts";
import { waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { act } from "react";
import { toast } from "sonner";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agents/agent-studio-test-utils";
import type {
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
  TaskApprovalMissingBuilderWorktreeModalModel,
} from "./kanban-page-model-types";
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
const defaultGitAbortConflict = async () => {};
const defaultHumanApproveTask = async () => {};
const defaultOpenResetImplementation = (_taskId: string) => true;

const taskApprovalContextGetMock = mock(defaultTaskApprovalContextGet);
const taskDirectMergeMock = mock(defaultTaskDirectMerge);
const taskDirectMergeCompleteMock = mock(defaultTaskDirectMergeComplete);
const taskPullRequestUpsertMock = mock(defaultTaskPullRequestUpsert);
const gitPushBranchMock = mock(defaultGitPushBranch);
const gitAbortConflictMock = mock(defaultGitAbortConflict);
const humanApproveTaskMock = mock(defaultHumanApproveTask);
const openResetImplementationMock = mock(defaultOpenResetImplementation);
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
  gitAbortConflict: gitAbortConflictMock,
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
  "gitAbortConflict",
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

let latestHarnessValue: ReturnType<typeof useTaskApprovalFlow> | null = null;

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

const waitForTaskApprovalModalLoaded = async (): Promise<void> => {
  await waitFor(() => {
    expect(latestHarnessValue?.taskApprovalModal).toBeTruthy();
    if (latestHarnessValue?.taskApprovalModal?.stage === "approval") {
      expect(latestHarnessValue.taskApprovalModal.isLoading).toBe(false);
    }
  });
};

const waitForTaskApprovalModalClosed = async (): Promise<void> => {
  await waitFor(() => {
    expect(latestHarnessValue?.taskApprovalModal).toBeNull();
  });
};

const createTaskApprovalContextFixture = (
  overrides: Partial<TaskApprovalContext> = {},
): TaskApprovalContext => ({
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
  suggestedSquashCommitMessage: undefined,
  providers: [],
  ...overrides,
});

const createReadyTaskApprovalContextResult = (
  overrides: Partial<TaskApprovalContext> = {},
): TaskApprovalContextLoadResult => ({
  outcome: "ready",
  approvalContext: createTaskApprovalContextFixture(overrides),
});

const createMissingBuilderWorktreeApprovalContextResult = (
  overrides: Partial<
    Extract<TaskApprovalContextLoadResult, { outcome: "missing_builder_worktree" }>
  > = {},
): TaskApprovalContextLoadResult => ({
  outcome: "missing_builder_worktree",
  taskId: "TASK-1",
  taskStatus: "human_review",
  ...overrides,
});

const createConflictDirectMergeResult = (
  overrides: { currentBranch?: string; workingDir?: string } = {},
) =>
  ({
    outcome: "conflicts" as const,
    conflict: {
      operation: "direct_merge_merge_commit" as const,
      currentBranch: overrides.currentBranch,
      targetBranch: "main",
      conflictedFiles: ["src/app.ts"],
      output: "conflict output",
      workingDir: overrides.workingDir,
    },
  }) as unknown as Awaited<ReturnType<typeof defaultTaskDirectMerge>>;

const createUseTaskApprovalFlowArgs = (
  overrides: Partial<Parameters<typeof useTaskApprovalFlow>[0]>,
): Parameters<typeof useTaskApprovalFlow>[0] => ({
  activeRepo: "/repo",
  tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
  requestPullRequestGeneration: async () => undefined,
  refreshTasks: async () => {},
  humanApproveTask: humanApproveTaskMock,
  openResetImplementation: openResetImplementationMock,
  ...overrides,
});

const expectApprovalModal = (): TaskApprovalApprovalModalModel => {
  const modal = latestHarnessValue?.taskApprovalModal;
  expect(modal?.stage).toBe("approval");
  if (!modal || modal.stage !== "approval") {
    throw new Error("Expected approval modal");
  }
  return modal;
};

const expectCompletionModal = (): TaskApprovalCompletionModalModel => {
  const modal = latestHarnessValue?.taskApprovalModal;
  expect(modal?.stage).toBe("complete_direct_merge");
  if (!modal || modal.stage !== "complete_direct_merge") {
    throw new Error("Expected direct-merge completion modal");
  }
  return modal;
};

const expectMissingBuilderWorktreeModal = (): TaskApprovalMissingBuilderWorktreeModalModel => {
  const modal = latestHarnessValue?.taskApprovalModal;
  expect(modal?.stage).toBe("missing_builder_worktree");
  if (!modal || modal.stage !== "missing_builder_worktree") {
    throw new Error("Expected missing-builder-worktree modal");
  }
  return modal;
};

describe("useTaskApprovalFlow", () => {
  beforeEach(async () => {
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
    gitAbortConflictMock.mockClear();
    gitAbortConflictMock.mockImplementation(defaultGitAbortConflict);
    humanApproveTaskMock.mockClear();
    humanApproveTaskMock.mockImplementation(defaultHumanApproveTask);
    openResetImplementationMock.mockClear();
    openResetImplementationMock.mockImplementation(defaultOpenResetImplementation);
  });

  afterAll(async () => {
    await restoreHostMocks();
    (toast as { loading: typeof toast.loading }).loading = originalToastLoading;
    (toast as { success: typeof toast.success }).success = originalToastSuccess;
    (toast as { error: typeof toast.error }).error = originalToastError;
  });

  test("opens immediately in loading state and does not fetch the settings snapshot", async () => {
    const pendingApprovalContext = createDeferred<TaskApprovalContextLoadResult>();
    taskApprovalContextGetMock.mockImplementationOnce(
      (async () => pendingApprovalContext.promise) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
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
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
    });

    expect(taskApprovalContextGetMock).toHaveBeenCalledWith("/repo", "TASK-1");
    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(expectApprovalModal().isLoading).toBe(true);
    expect(expectApprovalModal().mergeMethod).toBe("merge_commit");

    pendingApprovalContext.resolve(
      createReadyTaskApprovalContextResult({
        defaultMergeMethod: "squash",
        hasUncommittedChanges: true,
        uncommittedFileCount: 2,
        suggestedSquashCommitMessage: "feat: builder change",
      }),
    );

    await act(async () => {
      await pendingApprovalContext.promise;
      await Promise.resolve();
    });

    expect(expectApprovalModal().isLoading).toBe(false);
    expect(expectApprovalModal().mergeMethod).toBe("squash");
    expect(expectApprovalModal().squashCommitMessage).toBe("feat: builder change");
    expect(expectApprovalModal().hasUncommittedChanges).toBe(true);
    expect(expectApprovalModal().uncommittedFileCount).toBe(2);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("defaults to pull_request mode when GitHub provider is available", async () => {
    const pendingApprovalContext = createDeferred<TaskApprovalContextLoadResult>();
    taskApprovalContextGetMock.mockImplementationOnce(
      (async () => pendingApprovalContext.promise) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
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
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
    });

    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(expectApprovalModal().isLoading).toBe(true);
    expect(expectApprovalModal().mode).toBe("direct_merge");

    pendingApprovalContext.resolve(
      createReadyTaskApprovalContextResult({
        publishTarget: undefined,
        providers: [
          {
            providerId: "github",
            enabled: true,
            available: true,
            reason: undefined,
          },
        ],
      }),
    );

    await act(async () => {
      await pendingApprovalContext.promise;
      await Promise.resolve();
    });

    expect(expectApprovalModal().isLoading).toBe(false);
    expect(expectApprovalModal().mode).toBe("pull_request");
    expect(expectApprovalModal().pullRequestAvailable).toBe(true);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("defaults to direct_merge mode when no git provider is available", async () => {
    const pendingApprovalContext = createDeferred<TaskApprovalContextLoadResult>();
    taskApprovalContextGetMock.mockImplementationOnce(
      (async () => pendingApprovalContext.promise) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
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
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
    });

    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(expectApprovalModal().isLoading).toBe(true);
    expect(expectApprovalModal().mode).toBe("direct_merge");

    pendingApprovalContext.resolve(
      createReadyTaskApprovalContextResult({
        publishTarget: undefined,
      }),
    );

    await act(async () => {
      await pendingApprovalContext.promise;
      await Promise.resolve();
    });

    expect(expectApprovalModal().isLoading).toBe(false);
    expect(expectApprovalModal().mode).toBe("direct_merge");
    expect(expectApprovalModal().pullRequestAvailable).toBe(false);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("reopens in direct merge completion stage when a local merge is already recorded", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        workingDirectory: undefined,
        defaultMergeMethod: "rebase",
        directMerge: {
          method: "rebase",
          sourceBranch: "odt/TASK-1",
          targetBranch: { remote: "origin", branch: "main" },
          mergedAt: "2026-03-12T12:00:00Z",
        },
      }) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
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

  test("opens the recovery modal when the builder worktree is missing", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createMissingBuilderWorktreeApprovalContextResult() as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    expect(latestHarnessValue?.taskApprovalModal?.stage).toBe("missing_builder_worktree");
    expect(toastErrorMock).not.toHaveBeenCalled();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("keeps missing builder context as a fail-fast approval-loading error", async () => {
    taskApprovalContextGetMock.mockImplementationOnce(async () => {
      throw new Error(
        "Human approval requires a builder worktree for task TASK-1. Start Builder first.",
      );
    });

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    await waitForTaskApprovalModalClosed();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to open approval flow",
      expect.objectContaining({
        description:
          "Human approval requires a builder worktree for task TASK-1. Start Builder first.",
      }),
    );

    await act(async () => {
      await harness.unmount();
    });
  });

  test("completes the task from missing-builder-worktree recovery and closes the modal", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createMissingBuilderWorktreeApprovalContextResult() as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
          humanApproveTask: humanApproveTaskMock,
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectMissingBuilderWorktreeModal().onCompleteMissingBuilderWorktree();
      await Promise.resolve();
    });

    expect(humanApproveTaskMock).toHaveBeenCalledWith("TASK-1");
    await waitForTaskApprovalModalClosed();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("keeps the recovery modal open when completion fails from missing-builder-worktree recovery", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createMissingBuilderWorktreeApprovalContextResult() as unknown as never,
    );
    humanApproveTaskMock.mockImplementationOnce(async () => {
      throw new Error("Task is no longer reviewable");
    });

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
          humanApproveTask: humanApproveTaskMock,
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectMissingBuilderWorktreeModal().onCompleteMissingBuilderWorktree();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.stage).toBe("missing_builder_worktree");
    expect(latestHarnessValue?.taskApprovalModal?.isSubmitting).toBe(false);
    expect(latestHarnessValue?.taskApprovalModal?.errorMessage).toBe(
      "Task is no longer reviewable",
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Approval failed",
      expect.objectContaining({ description: "Task is no longer reviewable" }),
    );

    await act(async () => {
      await harness.unmount();
    });
  });

  test("only closes the recovery modal after reset handoff succeeds", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createMissingBuilderWorktreeApprovalContextResult() as unknown as never,
    );
    openResetImplementationMock.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
          openResetImplementation: openResetImplementationMock,
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectMissingBuilderWorktreeModal().onResetMissingBuilderWorktree();
      await Promise.resolve();
    });

    expect(openResetImplementationMock).toHaveBeenNthCalledWith(1, "TASK-1");
    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);

    await act(async () => {
      expectMissingBuilderWorktreeModal().onResetMissingBuilderWorktree();
      await Promise.resolve();
    });

    expect(openResetImplementationMock).toHaveBeenNthCalledWith(2, "TASK-1");
    await waitForTaskApprovalModalClosed();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("keeps non-recoverable approval-context failures fail-fast", async () => {
    taskApprovalContextGetMock.mockImplementationOnce(async () => {
      throw new Error("Builder branch is detached");
    });

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    await waitForTaskApprovalModalClosed();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to open approval flow",
      expect.objectContaining({ description: "Builder branch is detached" }),
    );

    await act(async () => {
      await harness.unmount();
    });
  });

  test("refetches approval context on reopen so worktree status is current", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        hasUncommittedChanges: true,
        uncommittedFileCount: 2,
      }) as unknown as never,
    );
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        hasUncommittedChanges: false,
        uncommittedFileCount: 0,
      }) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    expect(expectApprovalModal().hasUncommittedChanges).toBe(true);

    await act(async () => {
      latestHarnessValue?.taskApprovalModal?.onOpenChange(false);
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });

    expect(taskApprovalContextGetMock).toHaveBeenCalledTimes(2);
    expect(expectApprovalModal().hasUncommittedChanges).toBe(false);
    expect(expectApprovalModal().uncommittedFileCount).toBe(0);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("ignores a stale approval-context response from a superseded open cycle", async () => {
    const firstContext = createDeferred<TaskApprovalContextLoadResult>();
    taskApprovalContextGetMock.mockImplementationOnce(
      (async () => firstContext.promise) as unknown as never,
    );
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        taskId: "TASK-2",
        defaultMergeMethod: "rebase",
        hasUncommittedChanges: false,
        providers: [],
      }) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [
            createTaskCardFixture({ id: "TASK-1", title: "Task 1" }),
            createTaskCardFixture({ id: "TASK-2", title: "Task 2" }),
          ],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
    });

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-2");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    expect(latestHarnessValue?.taskApprovalModal?.taskId).toBe("TASK-2");
    expect(expectApprovalModal().mergeMethod).toBe("rebase");
    expect(expectApprovalModal().hasUncommittedChanges).toBe(false);

    firstContext.resolve(
      createReadyTaskApprovalContextResult({
        defaultMergeMethod: "squash",
        hasUncommittedChanges: true,
        uncommittedFileCount: 3,
      }),
    );

    await act(async () => {
      await firstContext.promise;
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.taskId).toBe("TASK-2");
    expect(expectApprovalModal().mergeMethod).toBe("rebase");
    expect(expectApprovalModal().hasUncommittedChanges).toBe(false);
    expect(expectApprovalModal().uncommittedFileCount).toBe(0);

    await act(async () => {
      await harness.unmount();
    });
  });

  test("publishes and completes a pending direct merge", async () => {
    taskDirectMergeMock.mockResolvedValueOnce({
      outcome: "completed" as const,
      task: createTaskCardFixture({ id: "TASK-1", status: "human_review" }),
    });
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        targetBranch: { remote: "upstream", branch: "main" },
        publishTarget: { remote: "upstream", branch: "main" },
      }) as unknown as never,
    );
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        targetBranch: { remote: "upstream", branch: "main" },
        publishTarget: { remote: "upstream", branch: "main" },
        directMerge: {
          method: "merge_commit",
          sourceBranch: "odt/TASK-1",
          targetBranch: { remote: "upstream", branch: "main" },
          mergedAt: "2026-03-12T12:00:00Z",
        },
      }) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onMergeMethodChange("squash");
      expectApprovalModal().onSquashCommitMessageChange("feat: merged task");
      await Promise.resolve();
    });

    await act(async () => {
      expectApprovalModal().onConfirm();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestHarnessValue?.taskApprovalModal?.stage).toBe("complete_direct_merge");
    });

    await act(async () => {
      expectCompletionModal().onCompleteDirectMerge();
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
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        targetBranch: { branch: "release/2026.03" },
        publishTarget: undefined,
      }) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: refreshTasksMock,
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onConfirm();
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

  test("opens the git conflict dialog when direct merge returns conflicts", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({ publishTarget: undefined }) as unknown as never,
    );
    taskDirectMergeMock.mockResolvedValueOnce(createConflictDirectMergeResult());

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onConfirm();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal).toBeNull();
    expect(latestHarnessValue?.taskGitConflictDialog?.open).toBe(true);
    expect(latestHarnessValue?.taskGitConflictDialog?.conflict).toEqual({
      operation: "direct_merge_merge_commit",
      currentBranch: null,
      targetBranch: "main",
      conflictedFiles: ["src/app.ts"],
      output: "conflict output",
      workingDir: null,
    });

    await act(async () => {
      await harness.unmount();
    });
  });

  test("reopens approval in direct_merge mode after aborting a git conflict", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({ publishTarget: undefined }) as unknown as never,
    );
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({ publishTarget: undefined }) as unknown as never,
    );
    taskDirectMergeMock.mockResolvedValueOnce(
      createConflictDirectMergeResult({
        currentBranch: "odt/TASK-1",
        workingDir: "/repo/.worktrees/task-1",
      }),
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onConfirm();
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskGitConflictDialog?.onAbort();
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    expect(gitAbortConflictMock).toHaveBeenCalledWith(
      "/repo",
      "direct_merge_merge_commit",
      "/repo/.worktrees/task-1",
    );
    expect(expectApprovalModal().mode).toBe("direct_merge");
    expect(latestHarnessValue?.taskGitConflictDialog).toBeNull();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("keeps the git conflict dialog open when Ask Builder does not start a resolution session", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({ publishTarget: undefined }) as unknown as never,
    );
    taskDirectMergeMock.mockResolvedValueOnce(
      createConflictDirectMergeResult({
        currentBranch: "odt/TASK-1",
        workingDir: "/repo/.worktrees/task-1",
      }),
    );
    const onResolveGitConflictMock = mock(async () => false);

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
          onResolveGitConflict: onResolveGitConflictMock,
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onConfirm();
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskGitConflictDialog?.onAskBuilder();
      await Promise.resolve();
    });

    expect(onResolveGitConflictMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "direct_merge_merge_commit" }),
      "TASK-1",
    );
    expect(latestHarnessValue?.taskGitConflictDialog?.open).toBe(true);
    expect(latestHarnessValue?.taskGitConflictDialog?.isHandlingConflict).toBe(false);
    expect(latestHarnessValue?.taskGitConflictDialog?.conflictAction).toBeNull();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("surfaces Ask Builder failures without closing the git conflict dialog", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({ publishTarget: undefined }) as unknown as never,
    );
    taskDirectMergeMock.mockResolvedValueOnce(
      createConflictDirectMergeResult({
        currentBranch: "odt/TASK-1",
        workingDir: "/repo/.worktrees/task-1",
      }),
    );
    const onResolveGitConflictMock = mock(async () => {
      throw new Error("Builder unavailable");
    });

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
          onResolveGitConflict: onResolveGitConflictMock,
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onConfirm();
      await Promise.resolve();
    });

    await act(async () => {
      latestHarnessValue?.taskGitConflictDialog?.onAskBuilder();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskGitConflictDialog?.open).toBe(true);
    expect(latestHarnessValue?.taskGitConflictDialog?.isHandlingConflict).toBe(false);
    expect(latestHarnessValue?.taskGitConflictDialog?.conflictAction).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to contact Builder",
      expect.objectContaining({ description: "Builder unavailable" }),
    );

    await act(async () => {
      await harness.unmount();
    });
  });

  test("creates a pull request manually, refreshes tasks, and closes the modal", async () => {
    const refreshTasksMock = mock(async () => {});
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        providers: [
          {
            providerId: "github",
            enabled: true,
            available: true,
            reason: undefined,
          },
        ],
      }) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [
            createTaskCardFixture({
              id: "TASK-1",
              title: "Ship approval flow",
              description: "Task description",
            }),
          ],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: refreshTasksMock,
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onConfirm();
      await Promise.resolve();
    });

    await waitForTaskApprovalModalClosed();
    expect(taskPullRequestUpsertMock).toHaveBeenCalledWith(
      "/repo",
      "TASK-1",
      "Ship approval flow",
      "Task description",
    );
    expect(refreshTasksMock).toHaveBeenCalledTimes(1);
    await waitForTaskApprovalModalClosed();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Pull request created",
      expect.objectContaining({ description: "PR #17" }),
    );

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
    taskApprovalContextGetMock.mockResolvedValue(
      createReadyTaskApprovalContextResult({
        providers: [
          {
            providerId: "github",
            enabled: true,
            available: true,
            reason: undefined,
          },
        ],
      }) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: requestPullRequestGenerationMock,
          refreshTasks: refreshTasksMock,
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onModeChange("pull_request");
      expectApprovalModal().onPullRequestDraftModeChange("generate_ai");
      await Promise.resolve();
    });

    await act(async () => {
      expectApprovalModal().onConfirm();
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
    taskApprovalContextGetMock.mockResolvedValue(
      createReadyTaskApprovalContextResult({
        providers: [
          {
            providerId: "github",
            enabled: true,
            available: true,
            reason: undefined,
          },
        ],
      }) as unknown as never,
    );

    const { useTaskApprovalFlow } = await import("./use-task-approval-flow");

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: requestPullRequestGenerationMock,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onModeChange("pull_request");
      expectApprovalModal().onPullRequestDraftModeChange("generate_ai");
      await Promise.resolve();
    });

    await act(async () => {
      expectApprovalModal().onConfirm();
      await Promise.resolve();
    });

    expect(requestPullRequestGenerationMock).toHaveBeenCalledWith("TASK-1");
    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.isSubmitting).toBe(false);
    expect(expectApprovalModal().mode).toBe("pull_request");
    expect(latestHarnessValue?.taskApprovalModal?.errorMessage).toBeNull();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(taskPullRequestUpsertMock).not.toHaveBeenCalled();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("does not let a stale PR-generation cancellation unlock a newer loading modal", async () => {
    const requestPullRequestGenerationDeferred = createDeferred<string | undefined>();
    const requestPullRequestGenerationMock = mock(
      async () => requestPullRequestGenerationDeferred.promise,
    );
    const secondApprovalContext = createDeferred<TaskApprovalContextLoadResult>();

    taskApprovalContextGetMock.mockImplementation((async (_repoPath: string, taskId: string) => {
      if (taskId === "TASK-1") {
        return createReadyTaskApprovalContextResult({
          taskId,
          providers: [
            {
              providerId: "github",
              enabled: true,
              available: true,
              reason: undefined,
            },
          ],
        });
      }

      return secondApprovalContext.promise;
    }) as unknown as never);

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [
            createTaskCardFixture({ id: "TASK-1", title: "Task 1" }),
            createTaskCardFixture({ id: "TASK-2", title: "Task 2" }),
          ],
          requestPullRequestGeneration: requestPullRequestGenerationMock,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onModeChange("pull_request");
      expectApprovalModal().onPullRequestDraftModeChange("generate_ai");
      await Promise.resolve();
    });

    await act(async () => {
      expectApprovalModal().onConfirm();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.taskId).toBe("TASK-1");
    expect(latestHarnessValue?.taskApprovalModal?.isSubmitting).toBe(true);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-2");
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.taskId).toBe("TASK-2");
    expect(expectApprovalModal().isLoading).toBe(true);

    requestPullRequestGenerationDeferred.resolve(undefined);

    await act(async () => {
      await requestPullRequestGenerationDeferred.promise;
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.taskId).toBe("TASK-2");
    expect(expectApprovalModal().isLoading).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.isSubmitting).toBe(false);

    secondApprovalContext.resolve(
      createReadyTaskApprovalContextResult({
        taskId: "TASK-2",
        providers: [],
      }),
    );

    await act(async () => {
      await secondApprovalContext.promise;
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    expect(latestHarnessValue?.taskApprovalModal?.taskId).toBe("TASK-2");
    expect(expectApprovalModal().mode).toBe("direct_merge");

    await act(async () => {
      await harness.unmount();
    });
  });

  test("keeps the modal open when pull request generation cannot start", async () => {
    taskApprovalContextGetMock.mockResolvedValue(
      createReadyTaskApprovalContextResult({
        providers: [
          {
            providerId: "github",
            enabled: true,
            available: true,
            reason: undefined,
          },
        ],
      }) as unknown as never,
    );
    const requestPullRequestGenerationMock = mock(async () => {
      throw new Error("Generation crashed");
    });

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: requestPullRequestGenerationMock,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    await act(async () => {
      expectApprovalModal().onModeChange("pull_request");
      expectApprovalModal().onPullRequestDraftModeChange("generate_ai");
      await Promise.resolve();
    });

    await act(async () => {
      expectApprovalModal().onConfirm();
      await Promise.resolve();
    });

    expect(requestPullRequestGenerationMock).toHaveBeenCalledTimes(1);
    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.isSubmitting).toBe(false);
    expect(expectApprovalModal().mode).toBe("pull_request");
    expect(latestHarnessValue?.taskApprovalModal?.errorMessage).toBe("Generation crashed");
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Approval failed",
      expect.objectContaining({ description: "Generation crashed" }),
    );
    expect(taskPullRequestUpsertMock).not.toHaveBeenCalled();

    await act(async () => {
      await harness.unmount();
    });
  });

  test("keeps direct-merge completion recoverable when publish configuration is incomplete", async () => {
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        publishTarget: { branch: "main" },
        directMerge: {
          method: "merge_commit",
          sourceBranch: "odt/TASK-1",
          targetBranch: { branch: "main" },
          mergedAt: "2026-03-12T12:00:00Z",
        },
      }) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    expect(latestHarnessValue?.taskApprovalModal?.stage).toBe("complete_direct_merge");

    await act(async () => {
      expectCompletionModal().onCompleteDirectMerge();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.open).toBe(true);
    expect(latestHarnessValue?.taskApprovalModal?.stage).toBe("complete_direct_merge");
    expect(latestHarnessValue?.taskApprovalModal?.isSubmitting).toBe(false);
    expect(latestHarnessValue?.taskApprovalModal?.errorMessage).toBe(
      "The configured target branch does not have a publish remote.",
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to finish direct merge",
      expect.objectContaining({
        description: "The configured target branch does not have a publish remote.",
      }),
    );

    await act(async () => {
      await harness.unmount();
    });
  });

  test("uses a fallback message when direct-merge publish fails without output", async () => {
    gitPushBranchMock.mockResolvedValueOnce({
      outcome: "rejected" as const,
      remote: "origin",
      branch: "main",
      output: "",
    } as unknown as never);
    taskApprovalContextGetMock.mockResolvedValueOnce(
      createReadyTaskApprovalContextResult({
        directMerge: {
          method: "merge_commit",
          sourceBranch: "odt/TASK-1",
          targetBranch: { remote: "origin", branch: "main" },
          mergedAt: "2026-03-12T12:00:00Z",
        },
      }) as unknown as never,
    );

    const Harness = (): ReactElement | null => {
      latestHarnessValue = useTaskApprovalFlow(
        createUseTaskApprovalFlowArgs({
          activeRepo: "/repo",
          tasks: [createTaskCardFixture({ id: "TASK-1", title: "Task" })],
          requestPullRequestGeneration: async () => undefined,
          refreshTasks: async () => {},
        }),
      );
      return null;
    };

    const harness = await mountApprovalHarness(Harness);

    await act(async () => {
      latestHarnessValue?.openTaskApproval("TASK-1");
      await Promise.resolve();
    });
    await waitForTaskApprovalModalLoaded();

    expect(latestHarnessValue?.taskApprovalModal?.stage).toBe("complete_direct_merge");

    await act(async () => {
      expectCompletionModal().onCompleteDirectMerge();
      await Promise.resolve();
    });

    expect(latestHarnessValue?.taskApprovalModal?.errorMessage).toBe(
      "Git push failed with no output.",
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Failed to finish direct merge",
      expect.objectContaining({ description: "Git push failed with no output." }),
    );

    await act(async () => {
      await harness.unmount();
    });
  });
});
