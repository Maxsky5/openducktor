import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioTaskHydration>[0];

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioTaskHydration, initialProps);

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: overrides.repoPath ?? "/tmp/repo",
  role: "planner",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  workingDirectory: "/tmp/repo",
  historyHydrationState: "not_requested",
  runtimeRecoveryState: "idle",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: createActiveWorkspace("/repo-a"),
  activeTaskId: "task-1",
  activeSession: null,
  agentStudioReadinessState: "ready",
  ensureSessionReadyForView: async () => true,
  refreshRuntimeAttachmentSources: async () => {},
  runtimeAttachmentCandidates: [],
  ...overrides,
});

describe("useAgentStudioTaskHydration", () => {
  test("treats the selected task as hydrated once repo and task are known", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      expect(harness.getLatest().isActiveTaskHydrated).toBe(true);
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("ensures view readiness for a ready session that still needs history", async () => {
    let resolveReady: (() => void) | undefined;
    const ensureSessionReadyForView = mock(
      async (): Promise<boolean> =>
        await new Promise<boolean>((resolve) => {
          resolveReady = () => resolve(true);
        }),
    );
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession(),
        ensureSessionReadyForView,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(() => ensureSessionReadyForView.mock.calls.length === 1);

      expect(ensureSessionReadyForView).toHaveBeenCalledWith({
        taskId: "task-1",
        externalSessionId: "external-1",
        repoReadinessState: "ready",
      });
      await harness.waitFor((state) => state.isActiveSessionHistoryHydrating);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(true);
      if (resolveReady) {
        resolveReady();
      }
      await harness.waitFor((state) => !state.isActiveSessionHistoryHydrating);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("rehydrates in the background when a partial transcript exists but history was never loaded", async () => {
    const ensureSessionReadyForView = mock(async (): Promise<boolean> => true);
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({
          historyHydrationState: "not_requested",
          messages: [
            {
              id: "message-tail-1",
              role: "assistant",
              content: "Only the new tail is in memory",
              timestamp: "2026-02-22T08:00:02.000Z",
            },
          ],
        }),
        ensureSessionReadyForView,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(() => ensureSessionReadyForView.mock.calls.length === 1);

      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(false);
      expect(ensureSessionReadyForView).toHaveBeenCalledWith({
        taskId: "task-1",
        externalSessionId: "external-1",
        repoReadinessState: "ready",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not ensure view readiness while repo readiness is still checking", async () => {
    const ensureSessionReadyForView = mock(async (): Promise<boolean> => true);
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({ historyHydrationState: "failed" }),
        agentStudioReadinessState: "checking",
        ensureSessionReadyForView,
      }),
    );

    try {
      await harness.mount();

      expect(ensureSessionReadyForView).not.toHaveBeenCalled();
      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces a blocking hydration failure when no transcript is available", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({ historyHydrationState: "failed" }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("rehydrates in the background when a session has transcript after a prior history failure", async () => {
    const ensureSessionReadyForView = mock(async (): Promise<boolean> => true);
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({
          historyHydrationState: "failed",
          messages: [
            {
              id: "message-1",
              role: "assistant",
              content: "Still viewable",
              timestamp: "2026-02-22T08:00:02.000Z",
            },
          ],
        }),
        ensureSessionReadyForView,
      }),
    );

    try {
      await harness.mount();

      await harness.waitFor(() => ensureSessionReadyForView.mock.calls.length === 1);
      expect(ensureSessionReadyForView).toHaveBeenCalledWith({
        taskId: "task-1",
        externalSessionId: "external-1",
        repoReadinessState: "ready",
      });
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});
