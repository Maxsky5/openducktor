import {
  CodexAppServerAdapter,
  type CodexAppServerAdapterOptions,
} from "@openducktor/adapters-codex-app-server";
import {
  agentSessionTranscriptEventSchema,
  codexAppServerRuntimeStreamEventSchema,
  parseCodexAppServerRequestResult,
  type CodexAppServerRuntimeStreamEvent,
  type AgentSessionTranscriptEvent,
  type CodexAppServerJsonValue,
  type CodexAppServerProtocolMessage,
} from "@openducktor/contracts";
import { getAgentSession } from "@/state/agent-session-collection";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import { createSessionTurnState } from "../support/session-turn-state";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSession,
  getSessionMessages,
} from "./session-events-test-harness";
import { createAgentSessionTranscriptEventConsumer } from "./session-transcript-events";
import {
  imageModelList,
  imageRuntime,
  imageSessionInput,
  imageSessionRef,
  imageThreadStartResult,
  nativeImage,
  nativeImageThread,
  nativeImageTurn,
} from "./codex-image-runtime.test-fixtures";

type RuntimeListener = Parameters<NonNullable<CodexAppServerAdapterOptions["subscribeEvents"]>>[1];

// Exercise public transport, adapter mutation, and frontend consumer boundaries without a runtime process.
export const createCodexImageSessionHarness = async (runtimeIds = ["runtime-live"]) => {
  const sessionsRef = createSessionsRef(
    runtimeIds.map((id) =>
      buildSession({
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: imageSessionRef(id).externalSessionId,
        status: "running",
      }),
    ),
  );
  const updateSession = createSessionUpdater(sessionsRef);
  const consumer = createAgentSessionTranscriptEventConsumer(
    {
      readSession: (identity) => getAgentSession(sessionsRef.current, identity),
      ensureSession: (_identity, create) => create(),
      updateSession,
      updateSessionTodos: () => {},
      sessionTurnState: createSessionTurnState(),
    },
    { batchWindowMs: 0 },
  );
  const events: AgentSessionTranscriptEvent[] = [];
  const listeners = new Map<string, RuntimeListener>();
  const delivered = new Map<string, PromiseWithResolvers<void>>();
  const history = new Map<string, ReturnType<typeof nativeImageTurn>[]>();
  let pendingHistory: {
    started: PromiseWithResolvers<void>;
    release: PromiseWithResolvers<void>;
  } | null = null;
  let selectedRuntime = runtimeIds[0]!;
  const consume = (event: AgentSessionTranscriptEvent) => {
    events.push(event);
    consumer.handle(event);
  };
  const options = {
    repoRuntimeResolver: { requireRepoRuntime: async () => imageRuntime(selectedRuntime) },
    subscribeEvents: (id, listener) => {
      listeners.set(id, listener);
      return () => {
        listeners.delete(id);
      };
    },
    respondServerRequest: async () => {},
    onRuntimeEventQueueFailure: (failure) => {
      delivered.get(failure.runtimeId)?.reject(failure.error);
    },
    onLiveSessionMutation: (mutation) => {
      for (const event of mutation.transcriptEvents)
        consume(agentSessionTranscriptEventSchema.parse(event));
      delivered.get(mutation.runtimeId)?.resolve();
    },
    transportFactory: (runtimeId) => ({
      request: async (request) => {
        const threadId = imageSessionRef(runtimeId).externalSessionId;
        switch (request.method) {
          case "initialize":
            return {
              codexHome: "/tmp/codex-home",
              platformFamily: "unix",
              platformOs: "macos",
              userAgent: "codex_cli_rs/test",
            };
          case "model/list":
            return parseCodexAppServerRequestResult("model/list", imageModelList());
          case "thread/start":
            return parseCodexAppServerRequestResult(
              "thread/start",
              imageThreadStartResult(threadId),
            );
          case "thread/name/set":
            return {};
          case "thread/read":
            return parseCodexAppServerRequestResult("thread/read", {
              thread: nativeImageThread(threadId),
            });
          case "thread/turns/list": {
            const gate = pendingHistory;
            gate?.started.resolve();
            if (gate) await gate.release.promise;
            return parseCodexAppServerRequestResult("thread/turns/list", {
              data: history.get(threadId) ?? [],
              nextCursor: null,
              backwardsCursor: null,
            });
          }
          default:
            throw new Error(`Unexpected image test request: ${request.method}`);
        }
      },
    }),
  } satisfies CodexAppServerAdapterOptions;
  const adapter = new CodexAppServerAdapter(options);
  // The renderer history reader and host live adapter do not share transient image state.
  const historyReaders = new Map(
    runtimeIds.map((runtimeId) => [
      runtimeId,
      new CodexAppServerAdapter({
        repoRuntimeResolver: { requireRepoRuntime: async () => imageRuntime(runtimeId) },
        transportFactory: options.transportFactory,
      }),
    ]),
  );
  const close = () => {
    pendingHistory?.release.resolve();
    for (const id of runtimeIds) {
      adapter.releaseRuntime(id);
      historyReaders.get(id)?.releaseRuntime(id);
    }
    consumer.close();
  };
  try {
    for (const id of runtimeIds) {
      selectedRuntime = id;
      await adapter.startSession(imageSessionInput(id));
    }
  } catch (error) {
    close();
    throw error;
  }
  const send = async (event: CodexAppServerRuntimeStreamEvent) => {
    const { runtimeId } = event;
    const listener = listeners.get(runtimeId);
    if (!listener) throw new Error(`No subscription for ${runtimeId}`);
    const completion = Promise.withResolvers<void>();
    delivered.set(runtimeId, completion);
    try {
      listener(event);
      await completion.promise;
    } finally {
      delivered.delete(runtimeId);
    }
  };
  const notify = (runtimeId: string, message: CodexAppServerProtocolMessage) =>
    send(
      codexAppServerRuntimeStreamEventSchema.parse({
        runtimeId,
        kind: "notification",
        message,
        receivedAt: new Date().toISOString(),
      }),
    );
  const images = (runtimeId: string) =>
    getSessionMessages(sessionsRef, imageSessionRef(runtimeId).externalSessionId).filter(
      (message) => message.meta?.kind === "image_generation",
    );
  return {
    events,
    close,
    images,
    session: (runtimeId: string) =>
      getSession(sessionsRef, imageSessionRef(runtimeId).externalSessionId),
    messages: (runtimeId: string) =>
      getSessionMessages(sessionsRef, imageSessionRef(runtimeId).externalSessionId),
    notify,
    request: (runtimeId: string, message: CodexAppServerJsonValue) =>
      send(
        codexAppServerRuntimeStreamEventSchema.parse({
          runtimeId,
          kind: "server_request",
          message,
          receivedAt: new Date().toISOString(),
        }),
      ),
    malformedRequest: (runtimeId: string, message: CodexAppServerJsonValue) => {
      // SAFETY: Test-only malformed request injection; the adapter must reject this invalid payload.
      const event = {
        runtimeId,
        kind: "server_request",
        message,
        receivedAt: new Date().toISOString(),
      } as CodexAppServerRuntimeStreamEvent;
      return send(event);
    },
    startTurn: (runtimeId: string, turnId: string) =>
      notify(runtimeId, {
        method: "turn/started",
        params: {
          threadId: imageSessionRef(runtimeId).externalSessionId,
          turn: nativeImageTurn(turnId),
        },
      }),
    endTurn: (runtimeId: string, turnId: string, status: "failed" | "interrupted" | "completed") =>
      notify(runtimeId, {
        method: "turn/completed",
        params: {
          threadId: imageSessionRef(runtimeId).externalSessionId,
          turn: nativeImageTurn(turnId, status),
        },
      }),
    image: (
      runtimeId: string,
      turnId: string,
      itemId: string,
      status: "in_progress" | "completed" = "in_progress",
    ) =>
      notify(runtimeId, {
        method: status === "completed" ? "item/completed" : "item/started",
        params: {
          threadId: imageSessionRef(runtimeId).externalSessionId,
          turnId,
          startedAtMs: Date.now(),
          completedAtMs: Date.now(),
          item: nativeImage(itemId, status),
        },
      }),
    setHistory: (runtimeId: string, turns: ReturnType<typeof nativeImageTurn>[]) => {
      history.set(imageSessionRef(runtimeId).externalSessionId, turns);
    },
    deferHistory: () => {
      const gate = {
        started: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      };
      pendingHistory = gate;
      return {
        started: gate.started.promise,
        release: () => {
          gate.release.resolve();
          pendingHistory = null;
        },
      };
    },
    loadHistory: async (runtimeId: string) => {
      const ref = imageSessionRef(runtimeId);
      const reader = historyReaders.get(runtimeId);
      if (!reader) throw new Error(`No history reader for ${runtimeId}`);
      const loaded = await reader.loadSessionHistory(ref);
      updateSession(ref, (session) => applyLoadedSessionHistory(session, loaded));
    },
    failRuntime: (runtimeId: string) => {
      for (const event of adapter.settleGeneratedImages(runtimeId))
        consume(agentSessionTranscriptEventSchema.parse(event));
      adapter.releaseRuntime(runtimeId);
    },
  };
};
