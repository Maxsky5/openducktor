import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { useRuntimeTranscriptSessionHydration } from "./use-runtime-transcript-session-hydration";
import type { RuntimeTranscriptSourceResolution } from "./use-runtime-transcript-source-resolution";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useRuntimeTranscriptSessionHydration>[0];

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useRuntimeTranscriptSessionHydration, initialProps, { wrapper });

const activeWorkspace: ActiveWorkspace = {
  workspaceId: "workspace-a",
  workspaceName: "Workspace A",
  repoPath: "/repo-a",
};

const createSource = (
  overrides: Partial<RuntimeSessionTranscriptSource> = {},
): RuntimeSessionTranscriptSource => ({
  runtimeKind: "opencode",
  runtimeId: "runtime-1",
  workingDirectory: "/repo-a/worktree",
  ...overrides,
});

const resolvedSource = (
  overrides: Partial<RuntimeTranscriptSourceResolution> = {},
): RuntimeTranscriptSourceResolution => ({
  isPending: false,
  error: null,
  runtimeId: "runtime-1",
  ...overrides,
});

const createHistoryMessage = (): AgentSessionHistoryMessage => ({
  messageId: "message-user-1",
  role: "user",
  timestamp: "2026-02-22T12:00:00.000Z",
  text: "Inspect this",
  displayParts: [],
  state: "read",
  parts: [],
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  isOpen: true,
  activeWorkspace,
  externalSessionId: "session-1",
  source: createSource(),
  sourceResolution: resolvedSource(),
  liveSession: null,
  readSessionHistory: mock(async () => [createHistoryMessage()]),
  ...overrides,
});

describe("useRuntimeTranscriptSessionHydration", () => {
  test("loads history and builds a readonly transcript session", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    const harness = createHookHarness(createBaseArgs({ readSessionHistory }));

    try {
      await harness.mount();
      await harness.waitFor((state) => state.session !== null);

      expect(readSessionHistory).toHaveBeenCalledWith(
        "/repo-a",
        "opencode",
        "/repo-a/worktree",
        "session-1",
      );
      const session = harness.getLatest().session;
      expect(session?.externalSessionId).toBe("session-1");
      expect(session?.purpose).toBe("transcript");
      expect(session?.status).toBe("idle");
      expect(session ? getSessionMessageCount(session) : 0).toBeGreaterThan(0);
      expect(harness.getLatest().historyError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("does not load history for live transcript sources", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    const harness = createHookHarness(
      createBaseArgs({
        source: createSource({ isLive: true }),
        readSessionHistory,
      }),
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest()).toEqual({
        session: null,
        isHistoryLoading: false,
        historyError: null,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("prefers an already attached live session over history hydration", async () => {
    const readSessionHistory = mock(async () => [createHistoryMessage()]);
    const liveSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      repoPath: "/repo-a",
      status: "running",
      runtimeId: "runtime-1",
    });
    const harness = createHookHarness(
      createBaseArgs({
        liveSession,
        readSessionHistory,
      }),
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().session).toEqual(liveSession);
      expect(harness.getLatest().isHistoryLoading).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces history load failures", async () => {
    const readSessionHistory = mock(async () => {
      throw new Error("history unavailable");
    });
    const harness = createHookHarness(createBaseArgs({ readSessionHistory }));

    try {
      await harness.mount();
      await harness.waitFor((state) => state.historyError !== null);

      expect(harness.getLatest()).toEqual({
        session: null,
        isHistoryLoading: false,
        historyError: "history unavailable",
      });
    } finally {
      await harness.unmount();
    }
  });
});
