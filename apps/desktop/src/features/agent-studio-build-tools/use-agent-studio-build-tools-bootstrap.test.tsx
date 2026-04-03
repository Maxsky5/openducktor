import { describe, expect, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import {
  type BuildToolsSessionDescriptor,
  useAgentStudioBuildToolsBootstrap,
} from "./use-agent-studio-build-tools-bootstrap";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioBuildToolsBootstrap>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioBuildToolsBootstrap, initialProps);

const toBuildToolsSession = (
  session: ReturnType<typeof createAgentSessionFixture> | null,
): BuildToolsSessionDescriptor => ({
  role: session?.role ?? null,
  status: session?.status ?? null,
  workingDirectory: session?.workingDirectory ?? null,
  runId: session?.runId ?? null,
  hasActiveSession: session != null,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: "/repo",
  viewRole: "build",
  session: toBuildToolsSession(null),
  viewSelectedTask: null,
  panelKind: "build_tools",
  isPanelOpen: true,
  isViewSessionHistoryHydrating: false,
  ...overrides,
});

describe("useAgentStudioBuildToolsBootstrap", () => {
  test("blocks build-tools bootstrap while the selected build session history is hydrating", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        session: toBuildToolsSession(
          createAgentSessionFixture({
            role: "build",
            workingDirectory: "/repo/worktree",
            runId: "run-1",
          }),
        ),
        isViewSessionHistoryHydrating: true,
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: false,
        repoPath: null,
        sessionWorkingDirectory: null,
        sessionRunId: null,
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
        viewSelectedTask: { id: "task-1" } as HookArgs["viewSelectedTask"],
        session: toBuildToolsSession(
          createAgentSessionFixture({
            role: "build",
            workingDirectory: "/repo/worktree",
            runId: "run-1",
          }),
        ),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest()).toEqual({
        isEnabled: true,
        repoPath: "/repo",
        sessionWorkingDirectory: "/repo/worktree",
        sessionRunId: "run-1",
        shouldEnableEventPolling: true,
        hasSelectedTask: true,
      });
    } finally {
      await harness.unmount();
    }
  });
});
