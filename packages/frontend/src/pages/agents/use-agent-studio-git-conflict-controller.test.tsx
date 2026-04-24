import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GitConflict } from "@/features/agent-studio-git";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import {
  createDeferred,
  createHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

const actualSharedHostModule = await import("@/state/operations/shared/host");

enableReactActEnvironment();

const gitAbortConflictMock = mock(async () => ({ output: "aborted" }));
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});

type UseAgentStudioGitConflictControllerHook =
  typeof import("./use-agent-studio-git-conflict-controller")["useAgentStudioGitConflictController"];

let useAgentStudioGitConflictController: UseAgentStudioGitConflictControllerHook;

type HookArgs = Parameters<UseAgentStudioGitConflictControllerHook>[0];

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  repoPath: "/repo",
  workingDir: null,
  branch: "feature/task-10",
  detectedConflictedFiles: [],
  worktreeStatusSnapshotKey: null,
  isBuilderSessionWorking: false,
  refreshDiffData: async () => {},
  clearActionErrors: () => {},
  setRebaseError: () => {},
  ...overrides,
});

const createConflict = (overrides: Partial<GitConflict> = {}): GitConflict => ({
  operation: "rebase" as const,
  currentBranch: "feature/task-10",
  targetBranch: "origin/main",
  conflictedFiles: ["src/main.ts"],
  output: "CONFLICT (content): Merge conflict in src/main.ts",
  workingDir: "/tmp/worktree/task-10",
  ...overrides,
});

beforeEach(async () => {
  mock.module("@/state/operations/shared/host", () => ({
    host: {
      gitAbortConflict: gitAbortConflictMock,
    },
  }));
  mock.module("sonner", () => ({
    toast: {
      success: toastSuccessMock,
      error: toastErrorMock,
    },
  }));
  ({ useAgentStudioGitConflictController } = await import(
    "./use-agent-studio-git-conflict-controller"
  ));
});

afterEach(async () => {
  await restoreMockedModules([
    ["@/state/operations/shared/host", async () => actualSharedHostModule],
    ["sonner", () => import("sonner")],
  ]);
});

beforeEach(() => {
  gitAbortConflictMock.mockClear();
  toastSuccessMock.mockClear();
  toastErrorMock.mockClear();
  gitAbortConflictMock.mockImplementation(async () => ({ output: "aborted" }));
});

describe("useAgentStudioGitConflictController", () => {
  test("hydrates persisted conflicts without auto-opening the modal", async () => {
    const harness = createHookHarness(
      useAgentStudioGitConflictController,
      createBaseArgs({
        detectedConflictedFiles: ["AGENTS.md"],
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().activeGitConflict).toEqual({
        operation: "rebase",
        currentBranch: "feature/task-10",
        targetBranch: "current rebase target",
        conflictedFiles: ["AGENTS.md"],
        output:
          "Git conflict is still in progress in this worktree. Previous command output is unavailable after reload.",
        workingDir: "/tmp/worktree/task-10",
      });
      expect(harness.getLatest().gitConflictAutoOpenNonce).toBe(0);
      expect(harness.getLatest().gitConflictCloseNonce).toBe(0);
      expect(harness.getLatest().isGitActionsLocked).toBe(true);
      expect(harness.getLatest().showLockReasonBanner).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("captures fresh conflicts and emits an auto-open nonce", async () => {
    const harness = createHookHarness(
      useAgentStudioGitConflictController,
      createBaseArgs({
        worktreeStatusSnapshotKey: "1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb",
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.captureFreshConflict(createConflict());
      });

      expect(harness.getLatest().activeGitConflict).toEqual(createConflict());
      expect(harness.getLatest().gitConflictAutoOpenNonce).toBe(1);
      expect(harness.getLatest().gitConflictCloseNonce).toBe(0);
    } finally {
      await harness.unmount();
    }
  });

  test("closes a local conflict after a newer clean snapshot arrives", async () => {
    const harness = createHookHarness(
      useAgentStudioGitConflictController,
      createBaseArgs({
        workingDir: "/tmp/worktree/task-10",
        worktreeStatusSnapshotKey: "1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb",
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.captureFreshConflict(createConflict({ conflictedFiles: ["AGENTS.md"] }));
      });

      await harness.update(
        createBaseArgs({
          workingDir: "/tmp/worktree/task-10",
          detectedConflictedFiles: [],
          worktreeStatusSnapshotKey: "1:cccccccccccccccc:dddddddddddddddd",
        }),
      );

      await harness.waitFor((state) => state.activeGitConflict === null);
      expect(harness.getLatest().gitConflictCloseNonce).toBe(1);
      expect(harness.getLatest().isGitActionsLocked).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps local conflicted file ordering when a newer snapshot reports the same files", async () => {
    const harness = createHookHarness(
      useAgentStudioGitConflictController,
      createBaseArgs({
        worktreeStatusSnapshotKey: "1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb",
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.captureFreshConflict(createConflict({ conflictedFiles: ["src/a.ts", "src/b.ts"] }));
      });

      await harness.update(
        createBaseArgs({
          detectedConflictedFiles: ["src/b.ts", "src/a.ts"],
          worktreeStatusSnapshotKey: "1:cccccccccccccccc:dddddddddddddddd",
        }),
      );

      expect(harness.getLatest().activeGitConflict?.conflictedFiles).toEqual([
        "src/a.ts",
        "src/b.ts",
      ]);
      expect(harness.getLatest().gitConflictCloseNonce).toBe(0);
    } finally {
      await harness.unmount();
    }
  });

  test("replaces placeholder conflict metadata when a hydrated conflict arrives with the same files", async () => {
    const harness = createHookHarness(
      useAgentStudioGitConflictController,
      createBaseArgs({
        detectedConflictedFiles: ["AGENTS.md"],
        workingDir: "/tmp/worktree/task-10",
        worktreeStatusSnapshotKey: "1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb",
      }),
    );

    try {
      await harness.mount();

      await harness.update(
        createBaseArgs({
          branch: null,
          detectedConflict: createConflict({
            currentBranch: null,
            conflictedFiles: ["AGENTS.md"],
            output: "interactive rebase in progress; onto main",
          }),
          detectedConflictedFiles: ["AGENTS.md"],
          workingDir: "/tmp/worktree/task-10",
          worktreeStatusSnapshotKey: "1:cccccccccccccccc:dddddddddddddddd",
        }),
      );

      expect(harness.getLatest().activeGitConflict).toEqual(
        createConflict({
          currentBranch: null,
          conflictedFiles: ["AGENTS.md"],
          output: "interactive rebase in progress; onto main",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("aborts conflicts using the captured working directory", async () => {
    const refreshDiffData = mock(async () => {});
    const abortDeferred = createDeferred<{ output: string }>();
    gitAbortConflictMock.mockImplementationOnce(async () => abortDeferred.promise);
    const harness = createHookHarness(
      useAgentStudioGitConflictController,
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.captureFreshConflict(createConflict());
      });

      await harness.update(
        createBaseArgs({
          refreshDiffData,
          workingDir: "/tmp/worktree/other",
        }),
      );

      await harness.run((state) => {
        void state.abortGitConflict();
      });

      await harness.waitFor(
        (state) => state.isHandlingGitConflict && state.gitConflictAction === "abort",
      );

      abortDeferred.resolve({ output: "aborted" });

      await harness.waitFor((state) => !state.isHandlingGitConflict);
      expect(gitAbortConflictMock).toHaveBeenCalledWith("/repo", "rebase", "/tmp/worktree/task-10");
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().gitConflictCloseNonce).toBe(1);
      expect(toastSuccessMock).toHaveBeenCalledWith("Rebase aborted");
    } finally {
      abortDeferred.resolve({ output: "aborted" });
      await harness.unmount();
    }
  });

  test("clears errors and keeps the conflict open when Builder accepts the handoff", async () => {
    const clearActionErrors = mock(() => {});
    const onResolveGitConflict = mock(async () => true);
    const harness = createHookHarness(
      useAgentStudioGitConflictController,
      createBaseArgs({
        clearActionErrors,
        detectedConflictedFiles: ["AGENTS.md"],
        onResolveGitConflict,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.askBuilderToResolveGitConflict();
      });

      expect(onResolveGitConflict).toHaveBeenCalledWith({
        operation: "rebase",
        currentBranch: "feature/task-10",
        targetBranch: "current rebase target",
        conflictedFiles: ["AGENTS.md"],
        output:
          "Git conflict is still in progress in this worktree. Previous command output is unavailable after reload.",
        workingDir: "/tmp/worktree/task-10",
      });
      expect(clearActionErrors).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().gitConflictAction).toBeNull();
      expect(harness.getLatest().isHandlingGitConflict).toBe(false);
      expect(harness.getLatest().activeGitConflict).not.toBeNull();
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Sent git conflict resolution request to Builder",
      );
      expect(toastErrorMock).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("silently resets ask-builder state when Builder declines the handoff", async () => {
    const clearActionErrors = mock(() => {});
    const onResolveGitConflict = mock(async () => false);
    const harness = createHookHarness(
      useAgentStudioGitConflictController,
      createBaseArgs({
        clearActionErrors,
        detectedConflictedFiles: ["AGENTS.md"],
        onResolveGitConflict,
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.askBuilderToResolveGitConflict();
      });

      expect(clearActionErrors).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().gitConflictAction).toBeNull();
      expect(harness.getLatest().isHandlingGitConflict).toBe(false);
      expect(harness.getLatest().activeGitConflict).not.toBeNull();
      expect(toastSuccessMock).toHaveBeenCalledTimes(0);
      expect(toastErrorMock).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("reports ask-builder failures and resets the transient action state", async () => {
    const setRebaseError = mock((_message: string | null) => {});
    const onResolveGitConflict = mock(async () => {
      throw new Error("Builder is offline");
    });
    const harness = createHookHarness(
      useAgentStudioGitConflictController,
      createBaseArgs({
        detectedConflictedFiles: ["AGENTS.md"],
        onResolveGitConflict,
        setRebaseError,
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.askBuilderToResolveGitConflict();
      });

      expect(setRebaseError).toHaveBeenCalledWith("Builder is offline");
      expect(harness.getLatest().gitConflictAction).toBeNull();
      expect(harness.getLatest().isHandlingGitConflict).toBe(false);
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to contact Builder", {
        description: "Builder is offline",
      });
    } finally {
      await harness.unmount();
    }
  });
});
