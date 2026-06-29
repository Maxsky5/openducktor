import type { Event, OpencodeClient, Session } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { subscribeSessionToRuntimeEvents } from "./session-registry";
import type {
  OpencodeEventLogger,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";

type RunEventStreamOptions = {
  logEvent?: OpencodeEventLogger;
  childrenBySessionId?: Record<string, Session[]>;
};

export const makeClientWithEvents = (
  events: Event[],
  options?: {
    childrenBySessionId?: Record<string, Session[]>;
  },
): OpencodeClient => {
  return {
    global: {
      event: async () => {
        async function* iterator(): AsyncGenerator<{ directory: string; payload: Event }> {
          for (const event of events) {
            const directory =
              (event as Event & { properties?: { directory?: string } }).properties?.directory ??
              "/repo";
            yield { directory, payload: event };
          }
        }
        return { stream: iterator() };
      },
    },
    ...(options?.childrenBySessionId
      ? {
          session: {
            children: async ({ sessionID }: { sessionID: string }) => ({
              data: options.childrenBySessionId?.[sessionID] ?? [],
            }),
          },
        }
      : {}),
  } as unknown as OpencodeClient;
};

export const makeSessionInput = (): SessionInput => ({
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  taskId: "task-1",
  role: "spec",
  systemPrompt: "System prompt",
});

export const makeSessionRecord = (client: OpencodeClient): SessionRecord => ({
  summary: {
    externalSessionId: "external-session-1",
    runtimeKind: "opencode",
    workingDirectory: "/repo",
    role: "spec",
    startedAt: "2026-02-22T12:00:00.000Z",
    status: "running",
  },
  input: makeSessionInput(),
  client,
  externalSessionId: "external-session-1",
  runtimeId: "runtime-opencode-1",
  streamTurnStatus: "active",
  isSendingUserMessage: false,
  isAwaitingRuntimeTurnStart: false,
  activeAssistantMessageId: null,
  completedAssistantMessageIds: new Set<string>(),
  emittedAssistantMessageIds: new Set<string>(),
  emittedUserMessageSignatures: new Map<string, string>(),
  emittedUserMessageStates: new Map(),
  pendingQueuedUserMessages: [],
  partsById: new Map(),
  messageRoleById: new Map(),
  messageMetadataById: new Map(),
  pendingDeltasByPartId: new Map(),
  subagentCorrelationKeyByPartId: new Map(),
  subagentCorrelationKeyByExternalSessionId: new Map(),
  subagentPartIdByCorrelationKey: new Map(),
  subagentPartIdByExternalSessionId: new Map(),
  pendingSubagentCorrelationKeysBySignature: new Map(),
  pendingSubagentCorrelationKeys: [],
  pendingSubagentSessionsByExternalSessionId: new Map(),
  pendingSubagentPartEmissionsByExternalSessionId: new Map(),
  pendingSubagentInputEventsByExternalSessionId: new Map(),
  pendingBackgroundTaskResultsByExternalSessionId: new Map(),
});

export const runEventStreamWithSession = async (
  events: Event[],
  configureSession?: (sessionRecord: SessionRecord) => void,
  options: RunEventStreamOptions = {},
): Promise<{ emitted: AgentEvent[]; sessionRecord: SessionRecord }> => {
  const client = makeClientWithEvents(events, {
    ...(options.childrenBySessionId ? { childrenBySessionId: options.childrenBySessionId } : {}),
  });
  const emitted: AgentEvent[] = [];
  const sessionRecord = makeSessionRecord(client);
  configureSession?.(sessionRecord);

  const sessions = new Map([[sessionRecord.externalSessionId, sessionRecord]]);
  const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();
  subscribeSessionToRuntimeEvents({
    sessions,
    runtimeEventTransports,
    createClient: () => client,
    runtimeId: sessionRecord.runtimeId,
    runtimeEndpoint: "http://127.0.0.1:12345",
    externalSessionId: sessionRecord.externalSessionId,
    sessionInput: sessionRecord.input,
    now: () => "2026-02-22T12:00:00.000Z",
    emit: (_externalSessionId: string, event: AgentEvent) => {
      emitted.push(event);
    },
    ...(options.logEvent ? { logEvent: options.logEvent } : {}),
  });
  const streamDone = runtimeEventTransports.get(sessionRecord.runtimeId)?.streamDone;
  if (!streamDone) {
    throw new Error("Expected OpenCode event transport to start.");
  }
  await streamDone;

  return { emitted, sessionRecord };
};

export const runEventStream = async (events: Event[]): Promise<AgentEvent[]> => {
  return (await runEventStreamWithSession(events)).emitted;
};
