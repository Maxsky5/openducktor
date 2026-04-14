import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  sessionMessageAt,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

type UseAgentStudioBuildWorktreeRefreshHook =
  typeof import("./use-agent-studio-build-worktree-refresh")["useAgentStudioBuildWorktreeRefresh"];

let useAgentStudioBuildWorktreeRefresh: UseAgentStudioBuildWorktreeRefreshHook;

const refreshWorktreeMock = mock(async (_mode?: string) => {});

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
  isSessionHistoryHydrating: false,
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
  test("does not refresh immediately for historical completed tool messages on session open", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        activeSession: createCompletedToolSession("apply_patch", "tool-1"),
      });
      expect(refreshWorktreeMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes worktree for newly completed mutating build tools", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createAgentSessionFixture({
        sessionId: "build-session-1",
        role: "build",
        messages: [],
      }),
    });

    try {
      await harness.mount();
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        activeSession: createCompletedToolSession("apply_patch", "tool-1"),
      });
      expect(refreshWorktreeMock).toHaveBeenCalledTimes(1);
      expect(refreshWorktreeMock).toHaveBeenLastCalledWith("soft");

      await harness.update({
        ...createBaseArgs(),
        activeSession: createAgentSessionFixture({
          sessionId: "build-session-1",
          role: "build",
          messages: [
            ...sessionMessagesToArray(createCompletedToolSession("apply_patch", "tool-1")),
            ...sessionMessagesToArray(createCompletedToolSession("bash", "tool-2")),
          ],
        }),
      });
      expect(refreshWorktreeMock).toHaveBeenCalledTimes(2);
      expect(refreshWorktreeMock).toHaveBeenLastCalledWith("soft");
    } finally {
      await harness.unmount();
    }
  });

  test("does not refresh for historical tool completions that arrive with session history hydration", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: createAgentSessionFixture({
        sessionId: "build-session-1",
        role: "build",
        messages: [],
      }),
      isSessionHistoryHydrating: true,
    });

    try {
      await harness.mount();
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        activeSession: createCompletedToolSession("apply_patch", "tool-1"),
        isSessionHistoryHydrating: true,
      });
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...createBaseArgs(),
        activeSession: createCompletedToolSession("apply_patch", "tool-1"),
        isSessionHistoryHydrating: false,
      });
      expect(refreshWorktreeMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("deduplicates completed tool messages within the same session", async () => {
    const initialSession = createAgentSessionFixture({
      sessionId: "build-session-1",
      role: "build",
      messages: [],
    });
    const activeSession = createCompletedToolSession("apply_patch", "tool-1");
    const harness = createHookHarness({
      ...createBaseArgs(),
      activeSession: initialSession,
    });

    try {
      await harness.mount();
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

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
        activeSession: createCompletedToolSession("ast_grep_search", "tool-1bb"),
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
        activeSession: createCompletedToolSession("look_at", "tool-1d"),
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

  test("refreshes when a same-id tool row transitions to completed", async () => {
    const baseCompletedMessage = sessionMessageAt(
      createCompletedToolSession("apply_patch", "tool-transition"),
      0,
    );
    if (!baseCompletedMessage?.meta || baseCompletedMessage.meta.kind !== "tool") {
      throw new Error("Expected completed tool message fixture");
    }

    const pendingToolMessage = {
      ...baseCompletedMessage,
      meta: {
        ...baseCompletedMessage.meta,
        status: "running" as const,
      },
    };
    const baseArgs = {
      ...createBaseArgs(),
      activeSession: createAgentSessionFixture({
        sessionId: "build-session-1",
        role: "build",
        messages: [pendingToolMessage],
      }),
    };
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      expect(refreshWorktreeMock).not.toHaveBeenCalled();

      await harness.update({
        ...baseArgs,
        activeSession: createAgentSessionFixture({
          sessionId: "build-session-1",
          role: "build",
          messages: [baseCompletedMessage],
        }),
      });

      expect(refreshWorktreeMock).toHaveBeenCalledTimes(1);
      expect(refreshWorktreeMock).toHaveBeenLastCalledWith("soft");
    } finally {
      await harness.unmount();
    }
  });
});
