import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { subscribeOpencodeEvents } from "./event-stream";
import type { SubagentSessionLink } from "./event-stream/shared";
import type { SessionInput, SessionRecord } from "./types";

export const makeClientWithEvents = (events: Event[]): OpencodeClient => {
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
    role: "spec",
    startedAt: "2026-02-22T12:00:00.000Z",
    status: "running",
  },
  input: makeSessionInput(),
  client,
  externalSessionId: "external-session-1",
  eventTransportKey: "http://127.0.0.1:12345",
  hasIdleSinceActivity: false,
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
});

export const runEventStreamWithSession = async (
  events: Event[],
  configureSession?: (sessionRecord: SessionRecord) => void,
  resolveSubagentSessionLink?: (childExternalSessionId: string) => SubagentSessionLink | undefined,
): Promise<{ emitted: AgentEvent[]; sessionRecord: SessionRecord }> => {
  const client = makeClientWithEvents(events);
  const emitted: AgentEvent[] = [];
  const sessionRecord = makeSessionRecord(client);
  configureSession?.(sessionRecord);

  await subscribeOpencodeEvents({
    context: {
      externalSessionId: "external-session-1",
      input: makeSessionInput(),
    },
    client,
    controller: new AbortController(),
    now: () => "2026-02-22T12:00:00.000Z",
    emit: (_sessionId, event) => {
      emitted.push(event);
    },
    getSession: () => sessionRecord,
    ...(resolveSubagentSessionLink ? { resolveSubagentSessionLink } : {}),
  });

  return { emitted, sessionRecord };
};

export const runEventStream = async (events: Event[]): Promise<AgentEvent[]> => {
  return (await runEventStreamWithSession(events)).emitted;
};
