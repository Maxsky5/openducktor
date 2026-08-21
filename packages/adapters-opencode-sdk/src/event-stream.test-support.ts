import type {
  EventSessionCreated,
  GlobalEvent,
  OpencodeClient,
  Session,
  SyncEventSessionCreated,
} from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import { subscribeSessionToRuntimeEvents } from "./session-registry";
import type {
  OpencodeEventLogger,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";

type RunEventStreamOptions = {
  logEvent?: OpencodeEventLogger;
};

type GlobalEventPayload = GlobalEvent["payload"];
type WithoutOuterSyncId<T> = T extends { type: "sync" } ? Omit<T, "id"> : never;
type ParentAlias = "parentId" | "parent_id";
type ParentAliasSessionInfo = Session & Partial<Record<ParentAlias, string>>;

export type TestGlobalEventPayload = GlobalEventPayload | WithoutOuterSyncId<GlobalEventPayload>;
export type RuntimeSourceSyncEventSessionCreated = Omit<SyncEventSessionCreated, "id">;
export type UnsupportedParentAliasSessionCreatedEvent = Omit<EventSessionCreated, "properties"> & {
  properties: Omit<EventSessionCreated["properties"], "info"> & {
    info: ParentAliasSessionInfo;
  };
};
export type UnsupportedRuntimeSourceSyncSessionCreatedEvent = Omit<
  RuntimeSourceSyncEventSessionCreated,
  "syncEvent"
> & {
  syncEvent: Omit<RuntimeSourceSyncEventSessionCreated["syncEvent"], "data"> & {
    data: Omit<RuntimeSourceSyncEventSessionCreated["syncEvent"]["data"], "info"> & {
      info: ParentAliasSessionInfo;
    };
  };
};

type TestGlobalEvent = Omit<GlobalEvent, "payload"> & {
  payload: TestGlobalEventPayload;
};

export const childSessionInfo = (childSessionId: string, parentID?: string): Session => ({
  id: childSessionId,
  slug: childSessionId,
  projectID: "project-1",
  directory: "/repo",
  ...(parentID ? { parentID } : {}),
  title: "Subagent",
  version: "1.0.0",
  time: {
    created: Date.parse("2026-02-22T12:00:10.000Z"),
    updated: Date.parse("2026-02-22T12:00:10.000Z"),
  },
});

export const childSessionCreatedEvent = (
  childSessionId: string,
  parentID = "external-session-1",
): EventSessionCreated =>
  ({
    id: `event-created-${childSessionId}`,
    type: "session.created",
    properties: {
      sessionID: childSessionId,
      info: childSessionInfo(childSessionId, parentID),
    },
  }) satisfies EventSessionCreated;

export const childSessionCreatedEventWithParentAlias = (
  childSessionId: string,
  parentAlias: ParentAlias,
  parentExternalSessionId = "external-session-1",
): UnsupportedParentAliasSessionCreatedEvent => {
  const info = {
    ...childSessionInfo(childSessionId),
    [parentAlias]: parentExternalSessionId,
  };
  return {
    id: `event-created-${childSessionId}-${parentAlias}`,
    type: "session.created",
    properties: {
      sessionID: childSessionId,
      info,
    },
  } satisfies UnsupportedParentAliasSessionCreatedEvent;
};

export const syncChildSessionCreatedEvent = (
  childSessionId: string,
  parentID = "external-session-1",
): SyncEventSessionCreated =>
  ({
    type: "sync",
    id: `sync-${childSessionId}`,
    syncEvent: {
      type: "session.created.1",
      id: `sync-event-${childSessionId}`,
      seq: 2,
      aggregateID: childSessionId,
      data: {
        sessionID: childSessionId,
        info: childSessionInfo(childSessionId, parentID),
      },
    },
  }) satisfies SyncEventSessionCreated;

export const runtimeSourceSyncChildSessionCreatedEvent = (
  childSessionId: string,
  parentID = "external-session-1",
): RuntimeSourceSyncEventSessionCreated =>
  ({
    type: "sync",
    syncEvent: {
      type: "session.created.1",
      id: `sync-event-runtime-source-${childSessionId}`,
      seq: 2,
      aggregateID: childSessionId,
      data: {
        sessionID: childSessionId,
        info: childSessionInfo(childSessionId, parentID),
      },
    },
  }) satisfies RuntimeSourceSyncEventSessionCreated;

export const runtimeSourceSyncChildSessionCreatedEventWithParentAlias = (
  childSessionId: string,
  parentAlias: ParentAlias,
  parentExternalSessionId = "external-session-1",
): UnsupportedRuntimeSourceSyncSessionCreatedEvent => {
  const info = {
    ...childSessionInfo(childSessionId),
    [parentAlias]: parentExternalSessionId,
  };
  return {
    type: "sync",
    syncEvent: {
      type: "session.created.1",
      id: `sync-event-runtime-source-${childSessionId}-${parentAlias}`,
      seq: 2,
      aggregateID: childSessionId,
      data: {
        sessionID: childSessionId,
        info,
      },
    },
  } satisfies UnsupportedRuntimeSourceSyncSessionCreatedEvent;
};

export const makeClientWithEvents = (events: TestGlobalEventPayload[]): OpencodeClient => {
  return {
    global: {
      event: async () => {
        async function* iterator(): AsyncGenerator<TestGlobalEvent> {
          for (const event of events) {
            const properties = "properties" in event ? event.properties : undefined;
            const directoryValue =
              properties && "directory" in properties ? properties.directory : undefined;
            const directory = typeof directoryValue === "string" ? directoryValue : "/repo";
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
  sessionScope: workflowAgentSessionScope("task-1", "spec"),
  runtimePolicy: { kind: "opencode" },
  systemPrompt: "System prompt",
});

export const makeSessionRecord = (client: OpencodeClient): SessionRecord => ({
  summary: {
    externalSessionId: "external-session-1",
    runtimeKind: "opencode",
    workingDirectory: "/repo",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
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
  pendingCompletedAssistantMessageIds: new Set<string>(),
  emittedAssistantMessageIds: new Set<string>(),
  emittedUserMessageSignatures: new Map<string, string>(),
  emittedUserMessageStates: new Map(),
  pendingUserMessageAdmissions: new Map(),
  pendingQueuedUserMessages: [],
  partsById: new Map(),
  partIdsByMessageId: new Map(),
  messageRoleById: new Map(),
  messageMetadataById: new Map(),
  compactionMessageIds: new Set(),
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
  events: TestGlobalEventPayload[],
  configureSession?: (sessionRecord: SessionRecord) => void,
  options: RunEventStreamOptions = {},
): Promise<{ emitted: AgentEvent[]; sessionRecord: SessionRecord }> => {
  const client = makeClientWithEvents(events);
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

export const runEventStream = async (events: TestGlobalEventPayload[]): Promise<AgentEvent[]> => {
  return (await runEventStreamWithSession(events)).emitted;
};
