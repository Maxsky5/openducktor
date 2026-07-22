import { describe, expect, test } from "bun:test";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentStudioBuildToolsBootstrap } from "./use-agent-studio-build-tools-bootstrap";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioBuildToolsBootstrap>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioBuildToolsBootstrap, initialProps);

const createSelectedSession = (
  overrides: Partial<HookArgs["selectedView"]["selectedSession"]> = {},
): HookArgs["selectedView"]["selectedSession"] => ({
  identity: null,
  activityState: null,
  selectedModel: null,
  loadedSession: null,
  runtimeData: {
    modelCatalog: null,
    todos: [],
    isLoadingModelCatalog: false,
    error: null,
  },
  runtimeReadiness: {
    state: "ready",
    message: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  transcriptState: { kind: "visible" },
  sessionAuxiliaryError: null,
  ...overrides,
});

const createSelectedView = (
  overrides: Partial<HookArgs["selectedView"]> = {},
): HookArgs["selectedView"] => ({
  role: "build",
  taskId: "task-1",
  selectedTask: null,
  selectedSession: createSelectedSession(),
  ...overrides,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  workspaceRepoPath: "/repo",
  selectedView: createSelectedView(),
  isGitTabActive: true,
  isRightPanelOpen: true,
  ...overrides,
});

describe("useAgentStudioBuildToolsBootstrap", () => {
  test("keeps build-tools context available while the selected transcript is loading", async () => {
    const selectedSessionSummary = toAgentSessionSummary(
      createAgentSessionFixture({
        role: "build",
        status: "running",
        workingDirectory: "/repo/worktree",
      }),
    );
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          selectedSession: createSelectedSession({
            identity: selectedSessionSummary,
            activityState: selectedSessionSummary.activityState,
          }),
        }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: true,
        isDevServerEnabled: true,
        repoPath: "/repo",
        sessionWorkingDirectory: "/repo/worktree",
        shouldEnableScheduledRefresh: true,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("enables build-tools bootstrap once the selected build session context is stable", async () => {
    const loadedSession = createAgentSessionFixture({
      role: "build",
      workingDirectory: "/repo/worktree",
    });
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          selectedTask: { id: "task-1" } as HookArgs["selectedView"]["selectedTask"],
          selectedSession: createSelectedSession({
            identity: toAgentSessionIdentity(loadedSession),
            activityState: "running",
          }),
        }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: true,
        isDevServerEnabled: true,
        repoPath: "/repo",
        sessionWorkingDirectory: "/repo/worktree",
        shouldEnableScheduledRefresh: true,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps build-tools context from the selected session identity before summaries load", async () => {
    const selectedSessionIdentity = toAgentSessionIdentity(
      createAgentSessionFixture({
        role: "build",
        workingDirectory: "/repo/worktree",
      }),
    );
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          selectedSession: createSelectedSession({ identity: selectedSessionIdentity }),
        }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: true,
        isDevServerEnabled: true,
        repoPath: "/repo",
        sessionWorkingDirectory: "/repo/worktree",
        shouldEnableScheduledRefresh: true,
      });
    } finally {
      await harness.unmount();
    }
  });
});
