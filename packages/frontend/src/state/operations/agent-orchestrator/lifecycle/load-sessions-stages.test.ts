import { describe, expect, spyOn, test } from "bun:test";
import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { liveAgentSessionLookupKey } from "./live-agent-session-cache";
import {
  createHydrationPromptAssemblerStage,
  createRuntimeResolutionPlannerStage,
  hydrateSessionRecordsStage,
  mergeHydratedMessages,
  preparePersistedSessionMergeStage,
  type SessionLoadIntent,
} from "./load-sessions-stages";

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: overrides.repoPath ?? "/tmp/repo",
  role: "build",
  status: "idle",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  workingDirectory: "/tmp/repo/worktree",
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
  promptOverrides: {},
  ...overrides,
});

const createRecord = (overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  externalSessionId: "external-1",
  role: "build",
  startedAt: "2026-03-01T09:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  runtimeKind: "opencode",
  selectedModel: null,
  ...overrides,
});

const createIntent = (overrides: Partial<SessionLoadIntent> = {}): SessionLoadIntent => ({
  repoPath: "/tmp/repo",
  workspaceId: "workspace-1",
  taskId: "task-1",
  mode: "bootstrap",
  requestedSessionId: null,
  requestedHistoryKey: null,
  shouldHydrateRequestedSession: false,
  shouldReconcileLiveSessions: false,
  historyPolicy: "none",
  ...overrides,
});

const createStateHarness = (sessions: Record<string, AgentSessionState>) => {
  let state = sessions;
  const sessionsRef = { current: state };
  return {
    sessionsRef,
    setSessionsById: (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    },
    updateSession: (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[externalSessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [externalSessionId]: updater(current),
      };
      sessionsRef.current = state;
    },
    getState: () => state,
  };
};

const createTaskFixture = (): TaskCard => ({
  id: "task-1",
  title: "Refactor loader",
  description: "Split hydration into explicit stages",
  notes: "",
  status: "ready_for_dev",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-03-01T09:00:00.000Z",
  createdAt: "2026-03-01T09:00:00.000Z",
});

const createRuntime = (
  workingDirectory: string,
  runtimeKind: RuntimeKind = "opencode",
): RuntimeInstanceSummary => ({
  kind: runtimeKind,
  runtimeId: "runtime-1",
  repoPath: "/tmp/repo",
  taskId: null,
  role: "workspace",
  workingDirectory,
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  startedAt: "2026-03-01T09:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
});

const createStdioRuntime = (
  runtimeId: string,
  workingDirectory: string,
): RuntimeInstanceSummary => ({
  ...createRuntime(workingDirectory),
  runtimeId,
  runtimeRoute: { type: "stdio", identity: runtimeId },
});

describe("load-sessions-stages", () => {
  test("prefers hydrated final assistant messages over stale local streamed rows with the same id", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final complete response",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
            providerId: "openai",
            modelId: "gpt-5",
          },
        },
      ],
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Partial streamed response",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0)?.content,
    ).toBe("Final complete response");
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0)?.meta,
    ).toMatchObject({
      kind: "assistant",
      isFinal: true,
      providerId: "openai",
      modelId: "gpt-5",
    });
  });

  test("does not coerce a same-id non-assistant message into a final assistant row", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "shared-id",
          role: "assistant",
          content: "Final complete response",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
      ],
      [
        {
          id: "shared-id",
          role: "tool",
          content: "Tool output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "part-1",
            callId: "call-1",
            tool: "bash",
            status: "completed",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "shared-id",
      role: "tool",
      content: "Tool output",
      meta: {
        kind: "tool",
        tool: "bash",
        status: "completed",
      },
    });
  });

  test("absorbs live reasoning and tool rows that duplicate hydrated history rows", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Hydrated reasoning",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: true,
          },
        },
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "bash completed",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "completed",
            output: "done",
          },
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final answer",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
      ],
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Final answer",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: true,
          },
        },
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Live reasoning",
          timestamp: "2026-03-01T09:00:04.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "bash running",
          timestamp: "2026-03-01T09:00:05.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "running",
            observedStartedAtMs: 100,
            inputReadyAtMs: 120,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(3);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "thinking",
      content: "Hydrated reasoning",
      meta: { kind: "reasoning", completed: true },
    });
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 1),
    ).toMatchObject({
      role: "tool",
      content: "bash completed",
      meta: {
        kind: "tool",
        status: "completed",
        output: "done",
        observedStartedAtMs: 100,
        inputReadyAtMs: 120,
      },
    });
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 2),
    ).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      content: "Final answer",
    });
  });

  test("preserves newer live reasoning rows when hydrated history is still non-terminal", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Hydrated partial reasoning",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
      ],
      [
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Live reasoning has continued",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "thinking",
      content: "Live reasoning has continued",
      meta: { kind: "reasoning", completed: false },
    });
  });

  test("keeps cross-id reasoning rows separate under canonical ids", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "thinking:assistant-1:thinking-1",
          role: "thinking",
          content: "Hydrated reasoning",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
      ],
      [
        {
          id: "thinking:assistant-1:alternate-thinking-key",
          role: "thinking",
          content: "Different live reasoning row",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "reasoning",
            partId: "thinking-1",
            completed: false,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(2);
  });

  test("does not downgrade live running tool rows to stale hydrated pending rows", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "pending",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "pending",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "running output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "running",
            output: "newer output",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "tool",
      content: "running output",
      meta: {
        kind: "tool",
        status: "running",
        output: "newer output",
      },
    });
  });

  test("preserves live running tool output over stale hydrated running rows", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "older running output",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "running",
            output: "older output",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "newer running output",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "running",
            output: "newer output",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "tool",
      content: "newer running output",
      meta: {
        kind: "tool",
        status: "running",
        output: "newer output",
      },
    });
  });

  test("keeps separate same-tool rows with different call ids", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "first",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "completed",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:call-2",
          role: "tool",
          content: "second",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-2",
            callId: "call-2",
            tool: "bash",
            status: "completed",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(2);
  });

  test("prefers hydrated completed tool rows over same-id live running rows", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "completed output",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "completed",
            output: "done",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "still running",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "running",
            observedStartedAtMs: 100,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      role: "tool",
      content: "completed output",
      meta: {
        kind: "tool",
        status: "completed",
        output: "done",
        observedStartedAtMs: 100,
      },
    });
  });

  test("absorbs live tool rows created before a call id is available", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:call-1",
          role: "tool",
          content: "completed output",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "call-1",
            tool: "bash",
            status: "completed",
            output: "done",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:tool-part-1",
          role: "tool",
          content: "still running",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: "",
            tool: "bash",
            status: "running",
            observedStartedAtMs: 100,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "tool:assistant-1:call-1",
      role: "tool",
      content: "completed output",
      meta: {
        kind: "tool",
        partId: "tool-part-1",
        callId: "call-1",
        status: "completed",
        observedStartedAtMs: 100,
      },
    });
  });

  test("matches tool rows with missing call ids without throwing", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "tool:assistant-1:hydrated-part-key",
          role: "tool",
          content: "completed output",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: undefined as unknown as string,
            tool: "bash",
            status: "completed",
            output: "done",
          },
        },
      ],
      [
        {
          id: "tool:assistant-1:current-part-key",
          role: "tool",
          content: "still running",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "tool",
            partId: "tool-part-1",
            callId: undefined as unknown as string,
            tool: "bash",
            status: "running",
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "tool:assistant-1:hydrated-part-key",
      role: "tool",
      content: "completed output",
      meta: {
        kind: "tool",
        partId: "tool-part-1",
        status: "completed",
        output: "done",
      },
    });
  });

  test("absorbs current subagent rows when hydrated history has the same child session id", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (build): Finished A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-completed",
            correlationKey: "part:msg-200:subtask-a",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Finished A",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-200:child-a",
          role: "system",
          content: "Subagent (build): Starting A",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-running",
            correlationKey: "session:msg-200:child-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Starting A",
            externalSessionId: "child-a",
            startedAtMs: 100,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      role: "system",
      content: "Subagent (build): Finished A",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "completed",
        externalSessionId: "child-a",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });
  });

  test("absorbs a unique current completed session row when hydrated history still has the unresolved part row", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (build): Starting A",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-running",
            correlationKey: "part:msg-200:subtask-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Starting A",
            startedAtMs: 100,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-201:child-a",
          role: "system",
          content: "Subagent (build): Finished A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-completed",
            correlationKey: "session:msg-201:child-a",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Finished A",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      role: "system",
      content: "Subagent (build): Finished A",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "completed",
        agent: "build",
        prompt: "Inspect repo",
        description: "Finished A",
        externalSessionId: "child-a",
        startedAtMs: 100,
        endedAtMs: 300,
      },
    });
  });

  test("absorbs a unique current cancelled session row when hydrated history still has the unresolved part row", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (build): Starting A",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-running",
            correlationKey: "part:msg-200:subtask-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Starting A",
            startedAtMs: 100,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-201:child-a",
          role: "system",
          content: "Subagent (build): Cancelled A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-cancelled",
            correlationKey: "session:msg-201:child-a",
            status: "cancelled",
            agent: "build",
            prompt: "Inspect repo",
            description: "Cancelled A",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 280,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      role: "system",
      content: "Subagent (build): Cancelled A",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "cancelled",
        agent: "build",
        prompt: "Inspect repo",
        description: "Cancelled A",
        externalSessionId: "child-a",
        startedAtMs: 100,
        endedAtMs: 280,
      },
    });
  });

  test("keeps same-prompt current session rows separate when the hydration fallback is ambiguous", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (build): Starting A",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-running",
            correlationKey: "part:msg-200:subtask-a",
            status: "running",
            agent: "build",
            prompt: "Inspect repo",
            description: "Starting A",
            startedAtMs: 100,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-201:child-a",
          role: "system",
          content: "Subagent (build): Finished A",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-completed",
            correlationKey: "session:msg-201:child-a",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Finished A",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
        {
          id: "subagent:session:msg-202:child-b",
          role: "system",
          content: "Subagent (build): Finished B",
          timestamp: "2026-03-01T09:00:03.000Z",
          meta: {
            kind: "subagent",
            partId: "session-b-completed",
            correlationKey: "session:msg-202:child-b",
            status: "completed",
            agent: "build",
            prompt: "Inspect repo",
            description: "Finished B",
            externalSessionId: "child-b",
            startedAtMs: 110,
            endedAtMs: 320,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(3);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "running",
      },
    });
  });

  test("does not absorb descriptor-less rows through the hydration fallback", () => {
    const merged = mergeHydratedMessages(
      "external-1",
      [
        {
          id: "subagent:part:msg-200:subtask-a",
          role: "system",
          content: "Subagent (subagent): Subagent activity",
          timestamp: "2026-03-01T09:00:01.000Z",
          meta: {
            kind: "subagent",
            partId: "part-a-running",
            correlationKey: "part:msg-200:subtask-a",
            status: "running",
            startedAtMs: 100,
          },
        },
      ],
      [
        {
          id: "subagent:session:msg-201:child-a",
          role: "system",
          content: "Subagent (subagent): Session child-a",
          timestamp: "2026-03-01T09:00:02.000Z",
          meta: {
            kind: "subagent",
            partId: "session-a-completed",
            correlationKey: "session:msg-201:child-a",
            status: "completed",
            externalSessionId: "child-a",
            startedAtMs: 100,
            endedAtMs: 300,
          },
        },
      ],
    );

    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: merged })).toBe(2);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 0),
    ).toMatchObject({
      id: "subagent:part:msg-200:subtask-a",
      meta: {
        kind: "subagent",
        correlationKey: "part:msg-200:subtask-a",
        status: "running",
      },
    });
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: merged }, 1),
    ).toMatchObject({
      id: "subagent:session:msg-201:child-a",
      meta: {
        kind: "subagent",
        correlationKey: "session:msg-201:child-a",
        status: "completed",
        externalSessionId: "child-a",
      },
    });
  });

  test("uses the in-memory requested session record without reloading persisted sessions", async () => {
    const existingSession = createSession();
    const stateHarness = createStateHarness({ "external-1": existingSession });
    let persistedLoads = 0;
    let setCalls = 0;

    const output = await preparePersistedSessionMergeStage({
      intent: createIntent({
        mode: "requested_history",
        requestedSessionId: "external-1",
        requestedHistoryKey: "/tmp/repo::task-1::external-1",
        shouldHydrateRequestedSession: true,
        historyPolicy: "requested_only",
      }),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: (updater) => {
        setCalls += 1;
        stateHarness.setSessionsById(updater);
      },
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => {
        persistedLoads += 1;
        return [createRecord()];
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    expect(persistedLoads).toBe(0);
    expect(setCalls).toBe(0);
    expect(output.recordsToHydrate).toHaveLength(1);
    expect(output.recordsToHydrate[0]?.externalSessionId).toBe("external-1");
    expect(output.historyHydrationSessionIds.has("external-1")).toBe(true);
  });

  test("merges persisted records while preserving in-memory pending input", async () => {
    const existingSession = createSession({
      pendingPermissions: [{ requestId: "perm-current", permission: "read", patterns: [".env"] }],
      pendingQuestions: [
        {
          requestId: "question-current",
          questions: [{ header: "Confirm", question: "Ship it?", options: [] }],
        },
      ],
    });
    const stateHarness = createStateHarness({ "external-1": existingSession });

    await preparePersistedSessionMergeStage({
      intent: createIntent(),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: stateHarness.setSessionsById,
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => [
        createRecord({
          startedAt: "2026-03-01T10:00:00.000Z",
          workingDirectory: "/tmp/repo/updated-worktree",
        }),
      ],
      loadRepoPromptOverrides: async () => ({}),
    });

    const nextSession = stateHarness.getState()["external-1"];
    expect(nextSession?.startedAt).toBe("2026-03-01T10:00:00.000Z");
    expect(nextSession?.pendingPermissions).toEqual(existingSession.pendingPermissions);
    expect(nextSession?.pendingQuestions).toEqual(existingSession.pendingQuestions);
  });

  test("preserves transcript-purpose sessions on non-requested loads", async () => {
    const existingSession = createSession({
      purpose: "transcript",
      role: "spec",
    });
    const stateHarness = createStateHarness({ "external-1": existingSession });

    await preparePersistedSessionMergeStage({
      intent: createIntent({
        mode: "bootstrap",
        shouldHydrateRequestedSession: false,
      }),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: stateHarness.setSessionsById,
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => [createRecord()],
      loadRepoPromptOverrides: async () => ({}),
    });

    const nextSession = stateHarness.getState()["external-1"];
    expect(nextSession?.purpose).toBe("transcript");
    expect(nextSession?.role).toBe("spec");
  });

  test("keeps requested-history persisted workflow records as primary sessions", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        purpose: "transcript",
        role: null,
      }),
    });

    await preparePersistedSessionMergeStage({
      intent: createIntent({
        mode: "requested_history",
        requestedSessionId: "external-1",
        shouldHydrateRequestedSession: true,
        historyPolicy: "requested_only",
      }),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: stateHarness.setSessionsById,
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => [createRecord()],
      loadRepoPromptOverrides: async () => ({}),
    });

    const requestedSession = stateHarness.getState()["external-1"];
    expect(requestedSession?.purpose).toBe("primary");
    expect(requestedSession?.role).toBe("build");
  });

  test("keeps recovered workflow records primary when runtime attachment is retried", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        purpose: "transcript",
        role: null,
      }),
    });

    await preparePersistedSessionMergeStage({
      intent: createIntent({
        mode: "recover_runtime_attachment",
        requestedSessionId: "external-1",
        historyPolicy: "none",
        shouldReconcileLiveSessions: true,
      }),
      sessionsRef: stateHarness.sessionsRef,
      setSessionsById: stateHarness.setSessionsById,
      isStaleRepoOperation: () => false,
      loadPersistedRecords: async () => [createRecord()],
      loadRepoPromptOverrides: async () => ({}),
    });

    const recoveredSession = stateHarness.getState()["external-1"];
    expect(recoveredSession?.purpose).toBe("primary");
    expect(recoveredSession?.role).toBe("build");
  });

  test("marks requested-history hydration failed when runtime resolution fails", async () => {
    const stateHarness = createStateHarness({ "external-1": createSession() });
    let promptLoads = 0;

    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: {
          hasSession: () => false,
          listLiveAgentSessionSnapshots: async () => [],
          loadSessionHistory: async () => [],
          attachSession: async (input) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
          resumeSession: async (input) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
        },
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["external-1"]),
        runtimePlanner: {
          resolveHydrationRuntime: async () => ({
            ok: false,
            runtimeKind: "opencode",
            reason: "No live runtime found for working directory /tmp/repo/worktree.",
          }),
          loadLiveAgentSessionSnapshot: async () => null,
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => {
          promptLoads += 1;
          return {};
        },
      }),
    ).rejects.toThrow("No live runtime found for working directory /tmp/repo/worktree.");

    expect(promptLoads).toBe(0);
    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("failed");
  });

  test("throws runtime resolution failures for reconcile hydration without marking the task reconciled", async () => {
    const initialSession = createSession();
    const stateHarness = createStateHarness({ "external-1": initialSession });
    let updateCalls = 0;

    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: {
          hasSession: () => false,
          listLiveAgentSessionSnapshots: async () => [],
          loadSessionHistory: async () => [],
          attachSession: async (input) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
          resumeSession: async (input) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
        },
        setSessionsById: stateHarness.setSessionsById,
        updateSession: (externalSessionId, updater) => {
          updateCalls += 1;
          stateHarness.updateSession(externalSessionId, updater);
        },
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(),
        failOnRuntimeResolutionError: true,
        runtimePlanner: {
          resolveHydrationRuntime: async () => ({
            ok: false,
            runtimeKind: "opencode",
            reason: "Multiple live stdio runtimes found for working directory /tmp/repo/worktree.",
          }),
          loadLiveAgentSessionSnapshot: async () => null,
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => ({}),
      }),
    ).rejects.toThrow(
      "Multiple live stdio runtimes found for working directory /tmp/repo/worktree.",
    );

    expect(stateHarness.getState()["external-1"]).toEqual(initialSession);
    expect(updateCalls).toBe(0);
  });

  test("loads requested-history hydration through the adapter for stdio OpenCode runtimes", async () => {
    const stateHarness = createStateHarness({ "external-1": createSession() });
    let historyLoads = 0;
    const historyInputs: LoadAgentSessionHistoryInput[] = [];

    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: {
          hasSession: () => false,
          listLiveAgentSessionSnapshots: async () => [],
          loadSessionHistory: async (input) => {
            historyLoads += 1;
            historyInputs.push(input);
            throw new Error("Adapter rejected stdio runtime connections.");
          },
          attachSession: async (input) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
          resumeSession: async (input) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
        },
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["external-1"]),
        runtimePlanner: {
          resolveHydrationRuntime: async () => ({
            ok: true,
            runtimeKind: "opencode",
            runtimeId: "runtime-stdio",
            workingDirectory: "/tmp/repo/worktree",
          }),
          loadLiveAgentSessionSnapshot: async () => null,
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => ({}),
      }),
    ).rejects.toThrow("Adapter rejected stdio runtime connections.");

    expect(historyLoads).toBe(1);
    expect(historyInputs).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "external-1",
        limit: 600,
      },
    ]);
    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("failed");
  });

  test("skips requested-history failure updates when the repo becomes stale during runtime resolution", async () => {
    let stale = false;
    const initialSession = createSession({ historyHydrationState: "hydrating" });
    const stateHarness = createStateHarness({ "external-1": initialSession });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listLiveAgentSessionSnapshots: async () => [],
        loadSessionHistory: async () => [],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => stale,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        resolveHydrationRuntime: async () => {
          stale = true;
          return {
            ok: false,
            runtimeKind: "opencode",
            reason: "No live runtime found for working directory /tmp/repo/worktree.",
          };
        },
        loadLiveAgentSessionSnapshot: async () => null,
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]).toEqual(initialSession);
  });

  test("skips runtime projection when the repo becomes stale during runtime resolution", async () => {
    let stale = false;
    const initialSession = createSession();
    const stateHarness = createStateHarness({ "external-1": initialSession });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listLiveAgentSessionSnapshots: async () => [],
        loadSessionHistory: async () => [],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => stale,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(),
      runtimePlanner: {
        resolveHydrationRuntime: async () => {
          stale = true;
          return {
            ok: true,
            runtimeKind: "opencode",
            runtimeId: "runtime-1",
            workingDirectory: "/tmp/repo/worktree",
          };
        },
        loadLiveAgentSessionSnapshot: async () => null,
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]).toEqual(initialSession);
  });

  test("clears a stale session title when the live snapshot has no custom title", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        title: "Fallback title",
        historyHydrationState: "hydrating",
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listLiveAgentSessionSnapshots: async () => [],
        loadSessionHistory: async () => [],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        }),
        loadLiveAgentSessionSnapshot: async () => ({
          externalSessionId: "external-1",
          title: "   ",
          role: "build",
          startedAt: "2026-03-01T09:00:00.000Z",
          status: { type: "busy" },
          pendingPermissions: [],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
        }),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]?.title).toBeUndefined();
  });

  test("hydrates parent subagent pending permission overlay from live child snapshots", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({ historyHydrationState: "hydrating" }),
    });
    const permissionRequest = {
      requestId: "perm-child-1",
      permission: "read",
      patterns: ["src/**"],
    };
    const loadedSnapshotSessionIds: string[] = [];

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listLiveAgentSessionSnapshots: async () => [],
        loadSessionHistory: async () => [
          {
            messageId: "assistant-parent",
            role: "assistant",
            timestamp: "2026-03-01T09:00:02.000Z",
            text: "",
            parts: [
              {
                kind: "subagent",
                messageId: "assistant-parent",
                partId: "subtask-1",
                correlationKey: "part:assistant-parent:subtask-1",
                status: "running",
                agent: "explorer",
                description: "Inspect session state",
                externalSessionId: "external-child-session",
              },
            ],
          },
        ],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        }),
        loadLiveAgentSessionSnapshot: async (record) => {
          const externalSessionId = record.externalSessionId;
          loadedSnapshotSessionIds.push(externalSessionId);
          if (externalSessionId === "external-1") {
            return {
              externalSessionId,
              title: "Parent",
              startedAt: "2026-03-01T09:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
              workingDirectory: "/tmp/repo/worktree",
            };
          }
          if (externalSessionId === "external-child-session") {
            return {
              externalSessionId,
              title: "Child",
              startedAt: "2026-03-01T09:00:01.000Z",
              status: { type: "busy" },
              pendingPermissions: [permissionRequest],
              pendingQuestions: [],
              workingDirectory: "/tmp/repo/worktree",
            };
          }
          return null;
        },
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(loadedSnapshotSessionIds).toContain("external-child-session");
    expect(
      stateHarness.getState()["external-1"]?.subagentPendingPermissionsByExternalSessionId?.[
        "external-child-session"
      ],
    ).toEqual([permissionRequest]);
  });

  test("preserves live parent subagent pending overlay entries when child snapshot has no pending permissions", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        historyHydrationState: "hydrating",
        subagentPendingPermissionsByExternalSessionId: {
          "external-child-session": [
            { requestId: "stale-perm", permission: "read", patterns: ["src/**"] },
          ],
          "unscanned-child-session": [
            { requestId: "live-perm", permission: "read", patterns: ["docs/**"] },
          ],
        },
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listLiveAgentSessionSnapshots: async () => [],
        loadSessionHistory: async () => [
          {
            messageId: "assistant-parent",
            role: "assistant",
            timestamp: "2026-03-01T09:00:02.000Z",
            text: "",
            parts: [
              {
                kind: "subagent",
                messageId: "assistant-parent",
                partId: "subtask-1",
                correlationKey: "part:assistant-parent:subtask-1",
                status: "running",
                agent: "explorer",
                description: "Inspect session state",
                externalSessionId: "external-child-session",
              },
            ],
          },
        ],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        }),
        loadLiveAgentSessionSnapshot: async (record) => {
          const externalSessionId = record.externalSessionId;
          if (externalSessionId === "external-1") {
            return {
              externalSessionId,
              title: "Parent",
              startedAt: "2026-03-01T09:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
              workingDirectory: "/tmp/repo/worktree",
            };
          }
          if (externalSessionId === "external-child-session") {
            return {
              externalSessionId,
              title: "Child",
              startedAt: "2026-03-01T09:00:01.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
              workingDirectory: "/tmp/repo/worktree",
            };
          }
          return null;
        },
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(
      stateHarness.getState()["external-1"]?.subagentPendingPermissionsByExternalSessionId,
    ).toEqual({
      "external-child-session": [
        { requestId: "stale-perm", permission: "read", patterns: ["src/**"] },
      ],
      "unscanned-child-session": [
        { requestId: "live-perm", permission: "read", patterns: ["docs/**"] },
      ],
    });
  });

  test("skips failed child pending input overlays without failing parent hydration", async () => {
    const stalePermission = { requestId: "stale-perm", permission: "read", patterns: ["src/**"] };
    const stateHarness = createStateHarness({
      "external-1": createSession({
        historyHydrationState: "hydrating",
        subagentPendingPermissionsByExternalSessionId: {
          "external-child-session": [stalePermission],
        },
      }),
    });
    const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    let warnedMessage: string | undefined;

    try {
      await hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: {
          hasSession: () => false,
          listLiveAgentSessionSnapshots: async () => [],
          loadSessionHistory: async () => [
            {
              messageId: "assistant-parent",
              role: "assistant",
              timestamp: "2026-03-01T09:00:02.000Z",
              text: "",
              parts: [
                {
                  kind: "subagent",
                  messageId: "assistant-parent",
                  partId: "subtask-1",
                  correlationKey: "part:assistant-parent:subtask-1",
                  status: "running",
                  agent: "explorer",
                  description: "Inspect session state",
                  externalSessionId: "external-child-session",
                },
              ],
            },
          ],
          attachSession: async (input) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
          resumeSession: async (input) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
        },
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["external-1"]),
        runtimePlanner: {
          resolveHydrationRuntime: async () => ({
            ok: true,
            runtimeKind: "opencode",
            runtimeId: "runtime-1",
            workingDirectory: "/tmp/repo/worktree",
          }),
          loadLiveAgentSessionSnapshot: async (record) => {
            const externalSessionId = record.externalSessionId;
            if (externalSessionId === "external-child-session") {
              throw new Error("child snapshot unavailable");
            }
            return {
              externalSessionId,
              title: "Parent",
              startedAt: "2026-03-01T09:00:00.000Z",
              status: { type: "busy" },
              pendingPermissions: [],
              pendingQuestions: [],
              workingDirectory: "/tmp/repo/worktree",
            };
          },
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => ({}),
      });
      warnedMessage = consoleWarnSpy.mock.calls[0]?.[0] as string | undefined;
    } finally {
      consoleWarnSpy.mockRestore();
    }

    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("hydrated");
    expect(
      stateHarness.getState()["external-1"]?.subagentPendingPermissionsByExternalSessionId,
    ).toEqual({
      "external-child-session": [stalePermission],
    });
    expect(warnedMessage).toContain(
      "Failed to hydrate pending input for subagent session 'external-child-session': child snapshot unavailable",
    );
  });

  test("runtime planner ignores stale hydrated runtime state and reuses preloaded live snapshots", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const liveSnapshot = {
      externalSessionId: "external-1",
      title: "Builder Session",
      role: "build",
      startedAt: "2026-03-01T09:00:00.000Z",
      status: { type: "busy" as const },
      pendingPermissions: [],
      pendingQuestions: [],
      workingDirectory,
    };
    let snapshotLoads = 0;
    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent({
        mode: "requested_history",
        requestedSessionId: "external-1",
        requestedHistoryKey: "/tmp/repo::task-1::external-1",
        shouldHydrateRequestedSession: true,
        historyPolicy: "requested_only",
      }),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime(workingDirectory)]],
        ]),
        preloadedLiveAgentSessionsByKey: new Map([
          [liveAgentSessionLookupKey("/tmp/repo", "opencode", workingDirectory), [liveSnapshot]],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        listLiveAgentSessionSnapshots: async () => {
          snapshotLoads += 1;
          return [];
        },
      },
      recordsToHydrate: [createRecord({ role: "planner", workingDirectory })],
    });

    const snapshot = await planner.loadLiveAgentSessionSnapshot(
      createRecord({ role: "planner", workingDirectory }),
      {
        ok: true,
        runtimeKind: "opencode",
        runtimeId: "runtime-current",
        workingDirectory,
      },
    );

    expect(snapshot).toEqual(liveSnapshot);
    expect(snapshotLoads).toBe(0);
  });

  test("runtime planner hydrates inactive worktree sessions through the repo runtime", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const snapshotRequests: Array<{ directories?: string[] }> = [];

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent({
        mode: "recover_runtime_attachment",
        requestedSessionId: "external-1",
        shouldReconcileLiveSessions: true,
        historyPolicy: "none",
      }),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime("/tmp/repo")]],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        listLiveAgentSessionSnapshots: async (input) => {
          snapshotRequests.push(input.directories ? { directories: input.directories } : {});
          return [];
        },
      },
      recordsToHydrate: [createRecord({ workingDirectory })],
    });

    const resolution = await planner.resolveHydrationRuntime(createRecord({ workingDirectory }));

    expect(snapshotRequests).toEqual([]);
    expect(resolution).toEqual({
      ok: true,
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      workingDirectory,
    });
  });

  test("runtime planner reuses cached live snapshots without re-scanning", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const preloadedLiveAgentSessionsByKey = new Map([
      [liveAgentSessionLookupKey("/tmp/repo", "opencode", workingDirectory), []],
    ]);
    const snapshotRequests: Array<{ directories?: string[] }> = [];

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent({
        mode: "recover_runtime_attachment",
        requestedSessionId: "external-1",
        shouldReconcileLiveSessions: true,
        historyPolicy: "none",
      }),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime("/tmp/repo")]],
        ]),
        preloadedLiveAgentSessionsByKey,
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        listLiveAgentSessionSnapshots: async (input) => {
          snapshotRequests.push(input.directories ? { directories: input.directories } : {});
          return [];
        },
      },
      recordsToHydrate: [createRecord({ workingDirectory })],
    });

    const resolution = await planner.resolveHydrationRuntime(createRecord({ workingDirectory }));

    expect(snapshotRequests).toEqual([]);
    expect(resolution).toEqual({
      ok: true,
      runtimeKind: "opencode",
      runtimeId: "runtime-1",
      workingDirectory,
    });
  });

  test("runtime planner prefers the first repo runtime when multiple stdio runtimes share a worktree", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const snapshotRequests: Array<{ directories?: string[] }> = [];

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent({
        mode: "recover_runtime_attachment",
        requestedSessionId: "external-1",
        shouldReconcileLiveSessions: true,
        historyPolicy: "none",
      }),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          [
            "opencode",
            [
              createStdioRuntime("runtime-stdio-root", "/tmp/repo"),
              createStdioRuntime("runtime-stdio-other", "/tmp/repo"),
            ],
          ],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        listLiveAgentSessionSnapshots: async (input) => {
          snapshotRequests.push(input.directories ? { directories: input.directories } : {});
          return [];
        },
      },
      recordsToHydrate: [createRecord({ workingDirectory })],
    });

    const resolution = await planner.resolveHydrationRuntime(createRecord({ workingDirectory }));

    expect(snapshotRequests).toEqual([]);
    expect(resolution).toEqual({
      ok: true,
      runtimeKind: "opencode",
      runtimeId: "runtime-stdio-root",
      workingDirectory,
    });
  });

  test("runtime planner reads preloaded live snapshots without a scan adapter", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const liveSnapshot = {
      externalSessionId: "external-1",
      title: "Builder Session",
      startedAt: "2026-03-01T09:00:00.000Z",
      status: { type: "busy" as const },
      pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: ["src/**"] }],
      pendingQuestions: [],
      workingDirectory,
    };

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent(),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime(workingDirectory)]],
        ]),
        preloadedLiveAgentSessionsByKey: new Map([
          [liveAgentSessionLookupKey("/tmp/repo", "opencode", workingDirectory), [liveSnapshot]],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      recordsToHydrate: [createRecord({ workingDirectory })],
    });

    const snapshot = await planner.loadLiveAgentSessionSnapshot(
      createRecord({ workingDirectory }),
      {
        ok: true,
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory,
      },
    );

    expect(snapshot).toEqual(liveSnapshot);
  });

  test("runtime planner uses preloaded snapshots to disambiguate same-directory stdio runtimes", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent(),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          [
            "opencode",
            [
              createStdioRuntime("runtime-stdio-a", workingDirectory),
              createStdioRuntime("runtime-stdio-b", workingDirectory),
            ],
          ],
        ]),
        preloadedLiveAgentSessionsByKey: new Map([
          [
            liveAgentSessionLookupKey("/tmp/repo", "opencode", workingDirectory),
            [
              {
                externalSessionId: "external-1",
                title: "Builder Session",
                startedAt: "2026-03-01T09:00:00.000Z",
                status: { type: "busy" as const },
                pendingPermissions: [],
                pendingQuestions: [],
                workingDirectory,
              },
            ],
          ],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      recordsToHydrate: [createRecord({ role: "planner", workingDirectory })],
    });

    const result = await planner.resolveHydrationRuntime(
      createRecord({ role: "planner", workingDirectory }),
    );
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeId).toBe("runtime-stdio-a");
    expect(result.workingDirectory).toBe(workingDirectory);
  });

  test("prompt assembler omits system prompt when the task is unavailable", async () => {
    const assembler = createHydrationPromptAssemblerStage({
      taskId: "task-1",
      taskRef: { current: [] },
    });

    const prelude = await assembler.buildHydrationPreludeMessages({
      record: createRecord({ role: "planner" }),
      promptOverrides: {},
    });
    const systemPrompt = await assembler.buildHydrationSystemPrompt({
      record: createRecord({ role: "planner" }),
      promptOverrides: {},
    });

    expect(systemPrompt).toBe("");
    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: prelude })).toBe(0);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: prelude }, 0),
    ).toBeUndefined();
  });

  test("prompt assembler can skip synthetic prelude messages entirely", async () => {
    const assembler = createHydrationPromptAssemblerStage({
      taskId: "task-1",
      taskRef: { current: [createTaskFixture()] },
      historyPreludeMode: "none",
    });

    const prelude = await assembler.buildHydrationPreludeMessages({
      record: createRecord({ role: "planner" }),
      promptOverrides: {},
    });
    const systemPrompt = await assembler.buildHydrationSystemPrompt({
      record: createRecord({ role: "planner" }),
      promptOverrides: {},
    });

    expect(systemPrompt).toBe("");
    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: prelude })).toBe(0);
  });

  test("prompt assembler builds system prompt and header messages when the task exists", async () => {
    const assembler = createHydrationPromptAssemblerStage({
      taskId: "task-1",
      taskRef: { current: [createTaskFixture()] },
    });

    const systemPrompt = await assembler.buildHydrationSystemPrompt({
      record: createRecord({ role: "planner" }),
      promptOverrides: {},
    });
    const prelude = await assembler.buildHydrationPreludeMessages({
      record: createRecord({ role: "planner" }),
      promptOverrides: {},
    });

    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: prelude })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: prelude }, 0),
    ).toMatchObject({
      id: "history:system-prompt:external-1",
      content: `System prompt:\n\n${systemPrompt}`,
    });
  });
});
