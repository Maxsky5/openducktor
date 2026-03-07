import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

type UseAgentStudioBuildWorktreeRefreshHook =
  typeof import("./use-agent-studio-build-worktree-refresh")["useAgentStudioBuildWorktreeRefresh"];

let useAgentStudioBuildWorktreeRefresh: UseAgentStudioBuildWorktreeRefreshHook;

const refreshWorktreeMock = mock(() => {});

type HookArgs = Parameters<UseAgentStudioBuildWorktreeRefreshHook>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioBuildWorktreeRefresh, initialProps);

const createCompletedToolSession = (tool: string, id = tool, input?: Record<string, unknown>) =>
  createAgentSessionFixture({
    sessionId: "build-session-1",
    role: "build",
    messages: [
      {
        id,
        role: "tool",
        content: "",
        timestamp: "2026-02-22T08:10:00.000Z",
        meta: {
          kind: "tool",
          partId: `part-${id}`,
          callId: `call-${id}`,
          tool,
          status: "completed",
          ...(input ? { input } : {}),
        },
      },
    ],
  });

const createBaseArgs = (): HookArgs => ({
  viewRole: "build",
  activeSession: null,
  refreshWorktree: refreshWorktreeMock,
});

beforeAll(async () => {
  ({ useAgentStudioBuildWorktreeRefresh } = await import(
    "./use-agent-studio-build-worktree-refresh"
  ));
});

beforeEach(() => {
  refreshWorktreeMock.mockClear();
});

describe("useAgentStudioBuildWorktreeRefresh", () => {
  test("refreshes worktree for newly completed mutating build tools", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        activeSession: createCompletedToolSession("apply_patch", "tool-1"),
      });
      expect(refreshWorktreeMock).toHaveBeenCalledTimes(1);

      await harness.update({
        ...createBaseArgs(),
        activeSession: createAgentSessionFixture({
          sessionId: "build-session-1",
          role: "build",
          messages: [
            ...createCompletedToolSession("apply_patch", "tool-1").messages,
            ...createCompletedToolSession("bash", "tool-2").messages,
          ],
        }),
      });
      expect(refreshWorktreeMock).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
    }
  });

  test("deduplicates completed tool messages within the same session", async () => {
    const activeSession = createCompletedToolSession("apply_patch", "tool-1");
    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession,
    });

    try {
      await harness.mount();
      expect(refreshWorktreeMock).toHaveBeenCalledTimes(1);

      await harness.update({
        ...createBaseArgs(),
        activeSession,
      });
      expect(refreshWorktreeMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("ignores read-only tools and non-build sessions", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createCompletedToolSession("read", "tool-1"),
    });

    try {
      await harness.mount();
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        activeSession: createCompletedToolSession("grep", "tool-1b"),
      });
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        activeSession: createCompletedToolSession("bash", "tool-1c", {
          command: "git status",
        }),
      });
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        viewRole: "spec",
        activeSession: createCompletedToolSession("apply_patch", "tool-2"),
      });
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        activeSession: createAgentSessionFixture({
          sessionId: "spec-session-1",
          role: "spec",
          messages: createCompletedToolSession("apply_patch", "tool-3").messages,
        }),
      });
      expect(refreshWorktreeMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});
