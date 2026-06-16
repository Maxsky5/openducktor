import { describe, expect, test } from "bun:test";
import {
  createAgentSessionFixture,
  createSelectedSessionTranscriptStateFixture,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
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
  activeSession: null,
  transcriptState: createSelectedSessionTranscriptStateFixture(),
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
  test("blocks build-tools bootstrap while the selected build session history is hydrating", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          activeSession: createAgentSessionFixture({
            role: "build",
            workingDirectory: "/repo/worktree",
          }),
          transcriptState: createSelectedSessionTranscriptStateFixture({
            kind: "session_loading",
            reason: "history",
          }),
        }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: false,
        repoPath: null,
        sessionWorkingDirectory: null,
        taskId: null,
        shouldEnableEventPolling: false,
        hasSelectedTask: false,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("enables build-tools bootstrap once the selected build session context is stable", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        selectedView: createSelectedView({
          selectedTask: { id: "task-1" } as HookArgs["selectedView"]["selectedTask"],
          activeSession: createAgentSessionFixture({
            role: "build",
            workingDirectory: "/repo/worktree",
          }),
        }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: true,
        repoPath: "/repo",
        sessionWorkingDirectory: "/repo/worktree",
        taskId: "task-1",
        shouldEnableEventPolling: true,
        hasSelectedTask: true,
      });
    } finally {
      await harness.unmount();
    }
  });
});
