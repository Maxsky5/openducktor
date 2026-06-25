import { describe, expect, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { codexTurnKey } from "./codex-app-server-requests";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import type { CodexThreadSnapshot } from "./codex-app-server-threads";
import { CodexPendingInputState } from "./codex-pending-input-state";
import { CodexRuntimeSessionEvents } from "./codex-runtime-session-events";
import { CodexSessionEventBus } from "./codex-session-event-bus";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";
import type { CodexSessionState } from "./types";

const waitForRuntimeEvent = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const flushRuntimeEvents = async (): Promise<void> => {
  await waitForRuntimeEvent();
  await waitForRuntimeEvent();
};

type RuntimeListener = (event: {
  runtimeId: string;
  kind: "notification" | "server_request";
  message: unknown;
}) => void;

const createRuntimeEvents = (
  overrides: Partial<ConstructorParameters<typeof CodexRuntimeSessionEvents>[0]> = {},
) =>
  new CodexRuntimeSessionEvents({
    subscribeEvents: undefined,
    drainServerRequests: async () => [],
    drainNotifications: undefined,
    respondServerRequest: async () => undefined,
    sessions: new Map(),
    activeTurnsBySessionId: new Map(),
    sessionEvents: new CodexSessionEventBus(),
    pendingInput: new CodexPendingInputState(),
    subagents: new CodexSubagentLinkState(),
    updateThreadStatus: () => undefined,
    flushQueuedUserMessagesLater: () => undefined,
    ...overrides,
  });

const model = { providerId: "openai", modelId: "gpt-5", variant: "medium" } as const;

const createSession = (threadId: string): CodexSessionState => ({
  summary: {
    externalSessionId: threadId,
    title: threadId,
    status: "running",
    role: "build",
    startedAt: "2026-06-13T00:00:00.000Z",
  },
  systemPrompt: "",
  role: "build",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  threadId,
  workingDirectory: "/repo",
  taskId: "task-1",
  model,
});

const createActiveTurn = (
  threadId: string,
  turnModel: AgentModelSelection = model,
): ActiveCodexTurn => ({
  session: createSession(threadId),
  turnStartPromise: Promise.resolve({}),
  isTurnSettled: () => false,
  markTurnSettled: () => undefined,
  handledRequestKeys: new Set(),
  queuedUserMessages: [],
  model: turnModel,
});

const createChildThreadSnapshot = (
  childThreadId: string,
  parentThreadId: string,
): CodexThreadSnapshot => ({
  id: childThreadId,
  cwd: "/repo",
  startedAt: "2026-06-13T00:00:00.000Z",
  title: childThreadId,
  status: { classification: "running" },
  parentThreadId,
  agentNickname: null,
  agentRole: null,
  subAgentSource: {
    parentThreadId,
    depth: 1,
    agentPath: ["agent"],
    agentNickname: null,
    agentRole: null,
  },
});

describe("CodexRuntimeSessionEvents", () => {
  test("clears turn-scoped stream metadata for one session only", () => {
    const runtimeEvents = createRuntimeEvents();
    const { modelByTurnKey } = runtimeEvents.historyLoadContext();
    const stoppedSessionTurnKey = codexTurnKey("thread/stopped", "turn-stopped");
    const otherSessionTurnKey = codexTurnKey("thread/other", "turn-active");
    runtimeEvents.bindActiveTurnId(createActiveTurn("thread/stopped"), "turn-stopped");
    runtimeEvents.bindActiveTurnId(createActiveTurn("thread/other"), "turn-active");

    runtimeEvents.clearSession("thread/stopped");

    expect(modelByTurnKey.has(stoppedSessionTurnKey)).toBe(false);
    expect(modelByTurnKey.has(otherSessionTurnKey)).toBe(true);
  });

  test("routes buffered child server requests through a loaded linked parent", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const pendingInput = new CodexPendingInputState();
    const subagents = new CodexSubagentLinkState();
    subagents.upsertLink({
      parentThreadId: "parent-thread",
      childThreadId: "child-thread",
      itemId: "spawn-1",
      status: "running",
    });
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = next;
        return () => undefined;
      },
      sessions,
      pendingInput,
      subagents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 50,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-1",
              header: "Choose",
              question: "Proceed?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });
    await waitForRuntimeEvent();

    expect(pendingInput.question("50")).toMatchObject({
      threadId: "child-thread",
      route: {
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      },
    });
  });

  test("reprocesses child server requests buffered before a parent subagent link is learned", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map([[parentSession.threadId, parentSession]]);
    const pendingInput = new CodexPendingInputState();
    const subagents = new CodexSubagentLinkState();
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = next;
        return () => undefined;
      },
      sessions,
      pendingInput,
      subagents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 51,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          questions: [
            {
              id: "question-item-1",
              header: "Choose",
              question: "Proceed?",
              options: ["Yes", "No"],
            },
          ],
        },
      },
    });
    await flushRuntimeEvents();

    expect(pendingInput.question("51")).toBeUndefined();
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toHaveLength(0);

    listener?.({
      runtimeId: "runtime-1",
      kind: "notification",
      message: {
        method: "item/completed",
        params: {
          threadId: "parent-thread",
          turnId: "turn-parent",
          completedAtMs: 1_777_766_401_000,
          item: {
            type: "collabAgentToolCall",
            id: "spawn-1",
            tool: "spawnAgent",
            status: "completed",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread"],
            agentsStates: {
              "child-thread": { status: "running" },
            },
          },
        },
      },
    });
    await flushRuntimeEvents();

    expect(pendingInput.question("51")).toMatchObject({
      threadId: "child-thread",
      route: {
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      },
    });
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toHaveLength(1);
  });

  test("drains buffered child approvals when an inventory route is known before parent load", async () => {
    let listener: RuntimeListener | null = null;
    const parentSession = createSession("parent-thread");
    const sessions = new Map<string, CodexSessionState>();
    const pendingInput = new CodexPendingInputState();
    const subagents = new CodexSubagentLinkState();
    const runtimeEvents = createRuntimeEvents({
      subscribeEvents: (_runtimeId, next) => {
        listener = next;
        return () => undefined;
      },
      sessions,
      pendingInput,
      subagents,
    });

    await runtimeEvents.ensureRuntimeEventSubscription("runtime-1");
    listener?.({
      runtimeId: "runtime-1",
      kind: "server_request",
      message: {
        id: 52,
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.MCP_SERVER_ELICITATION_REQUEST,
        params: {
          threadId: "child-thread",
          turnId: "turn-child",
          serverName: "semble",
          mode: "form",
          message: 'Allow the semble MCP server to run tool "search"?',
          requestedSchema: { type: "object", properties: {} },
          _meta: {
            codex_approval_kind: "mcp_tool_call",
            tool_name: "search",
            persist: ["session"],
          },
        },
      },
    });
    await flushRuntimeEvents();

    subagents.recordThread(createChildThreadSnapshot("child-thread", "parent-thread"));
    await flushRuntimeEvents();

    expect(pendingInput.approval("52")).toBeUndefined();

    sessions.set(parentSession.threadId, parentSession);
    await runtimeEvents.drainBufferedStreamEvents(parentSession.threadId);

    expect(pendingInput.approval("52")).toMatchObject({
      threadId: "child-thread",
      route: {
        parentExternalSessionId: "parent-thread",
        childExternalSessionId: "child-thread",
      },
    });
    expect(pendingInput.pendingApprovalEventsForSession("parent-thread")).toHaveLength(1);
  });
});
