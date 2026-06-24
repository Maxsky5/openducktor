import { describe, expect, test } from "bun:test";
import type { AgentModelSelection } from "@openducktor/core";
import { codexTurnKey } from "./codex-app-server-requests";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import { CodexPendingInputState } from "./codex-pending-input-state";
import { CodexRuntimeSessionEvents } from "./codex-runtime-session-events";
import { CodexSessionEventBus } from "./codex-session-event-bus";
import type { CodexSessionState } from "./types";

const createRuntimeEvents = () =>
  new CodexRuntimeSessionEvents({
    subscribeEvents: undefined,
    drainServerRequests: async () => [],
    drainNotifications: undefined,
    respondServerRequest: async () => undefined,
    sessions: new Map(),
    activeTurnsBySessionId: new Map(),
    sessionEvents: new CodexSessionEventBus(),
    pendingInput: new CodexPendingInputState(),
    updateThreadStatus: () => undefined,
    flushQueuedUserMessagesLater: () => undefined,
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
});
