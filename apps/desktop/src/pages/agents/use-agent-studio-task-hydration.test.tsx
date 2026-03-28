import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioTaskHydration>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioTaskHydration, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: "/repo-a",
  activeTaskId: "task-1",
  activeSession: null,
  hydrateRequestedTaskSessionHistory: async () => {},
  ...overrides,
});

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "planner",
  scenario: "planner_initial",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo",
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

  test("hydrates message history only for the active session", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession(),
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(true);
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ historyHydrationState: "hydrated" }),
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-1",
      });

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ historyHydrationState: "hydrated" }),
          hydrateRequestedTaskSessionHistory,
        }),
      );
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ sessionId: "session-2", externalSessionId: "external-2" }),
          hydrateRequestedTaskSessionHistory,
        }),
      );
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 2);
    } finally {
      await harness.unmount();
    }
  });

  test("marks session history hydration as failed when the query rejects", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async () => {
      throw new Error("history failed");
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession(),
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isActiveSessionHistoryHydrationFailed);

      expect(harness.getLatest().isActiveTaskHydrated).toBe(true);
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("skips requested history hydration for a live session that already has local messages", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({
          status: "running",
          historyHydrationState: "hydrated",
          messages: [
            {
              id: "kickoff",
              role: "user",
              content: "Kickoff prompt",
              timestamp: "2026-02-22T08:00:05.000Z",
            },
          ],
        }),
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();

      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("still hydrates when a reused live session only has newly added local messages", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({
          status: "running",
          historyHydrationState: "not_requested",
          messages: [
            {
              id: "local-user-message",
              role: "user",
              content: "Generate the PR",
              timestamp: "2026-02-22T08:00:05.000Z",
            },
          ],
        }),
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({
            status: "running",
            historyHydrationState: "hydrated",
            messages: [
              {
                id: "m-user",
                role: "user",
                content: "Earlier request",
                timestamp: "2026-02-22T08:00:00.000Z",
              },
              {
                id: "local-user-message",
                role: "user",
                content: "Generate the PR",
                timestamp: "2026-02-22T08:00:05.000Z",
              },
            ],
          }),
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-1",
      });
    } finally {
      await harness.unmount();
    }
  });
});
