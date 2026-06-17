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

const createSelectedView = (
  overrides: Partial<HookArgs["selectedView"]> = {},
): HookArgs["selectedView"] => ({
  role: "build",
  taskId: "task-1",
  selectedTask: null,
  selectedSessionIdentity: null,
  selectedSessionActivityState: null,
  ...overrides,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  workspaceRepoPath: "/repo",
  selectedView: createSelectedView(),
  panelKind: "build_tools",
  isPanelOpen: true,
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
          selectedSessionIdentity: selectedSessionSummary,
          selectedSessionActivityState: selectedSessionSummary.activityState,
        }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: true,
        repoPath: "/repo",
        sessionWorkingDirectory: "/repo/worktree",
        shouldEnableEventPolling: true,
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
          selectedSessionIdentity: toAgentSessionIdentity(loadedSession),
          selectedSessionActivityState: "running",
        }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: true,
        repoPath: "/repo",
        sessionWorkingDirectory: "/repo/worktree",
        shouldEnableEventPolling: true,
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
          selectedSessionIdentity,
          selectedSessionActivityState: null,
        }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: true,
        repoPath: "/repo",
        sessionWorkingDirectory: "/repo/worktree",
        shouldEnableEventPolling: true,
      });
    } finally {
      await harness.unmount();
    }
  });
});
