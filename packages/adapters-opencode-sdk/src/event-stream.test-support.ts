import type {
  EventPermissionAsked,
  EventPermissionReplied,
  EventPermissionV2Asked,
  EventPermissionV2Replied,
  EventQuestionAsked,
  EventQuestionRejected,
  EventQuestionReplied,
  EventQuestionV2Asked,
  EventQuestionV2Rejected,
  EventQuestionV2Replied,
  EventSessionCreated,
  EventSessionStatus,
  OpencodeClient,
  QuestionInfo,
  Session,
  SessionStatus,
  SyncEventSessionCreated,
} from "@opencode-ai/sdk/v2/client";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { JsonObject } from "@openducktor/contracts";
import type { AgentEvent } from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import { subscribeSessionToRuntimeEvents } from "./session-registry";
import {
  createOpencodeEventFixtures,
  type MalformedOpencodeControlEventFixture,
  type OpencodeEventFixtureInput,
} from "./opencode-protocol-test-fixtures";
import type {
  OpencodeEventLogger,
  RuntimeEventTransportRecord,
  SessionInput,
  SessionRecord,
} from "./types";
import { z } from "zod";

type RunEventStreamOptions = {
  logEvent?: OpencodeEventLogger;
};

type ParentAlias = "parentId" | "parent_id";
type ParentAliasSessionInfo = Session & Partial<Record<ParentAlias, string>>;
type ControlEventProperties = JsonObject;

export type MalformedControlEvent = MalformedOpencodeControlEventFixture;

export type TestGlobalEventPayload = OpencodeEventFixtureInput;
export type UnsupportedParentAliasSessionCreatedEvent = Omit<EventSessionCreated, "properties"> & {
  properties: Omit<EventSessionCreated["properties"], "info"> & {
    info: ParentAliasSessionInfo;
  };
};
export type UnsupportedRuntimeSourceSyncSessionCreatedEvent = Omit<
  SyncEventSessionCreated,
  "syncEvent"
> & {
  syncEvent: Omit<SyncEventSessionCreated["syncEvent"], "data"> & {
    data: Omit<SyncEventSessionCreated["syncEvent"]["data"], "info"> & {
      info: ParentAliasSessionInfo;
    };
  };
};

export const childSessionInfo = (childSessionId: string, parentID?: string): Session => {
  const session: Session = {
    id: childSessionId,
    slug: childSessionId,
    projectID: "project-1",
    directory: "/repo",
    title: "Subagent",
    version: "1.0.0",
    time: {
      created: Date.parse("2026-02-22T12:00:10.000Z"),
      updated: Date.parse("2026-02-22T12:00:10.000Z"),
    },
  };
  if (parentID) {
    session.parentID = parentID;
  }
  return session;
};

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
): SyncEventSessionCreated =>
  ({
    type: "sync",
    id: `sync-runtime-source-${childSessionId}`,
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
  }) satisfies SyncEventSessionCreated;

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
    id: `sync-runtime-source-${childSessionId}-${parentAlias}`,
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

export const permissionAskedEvent = (input: {
  requestId: string;
  sessionId?: string;
  permission?: string;
  patterns?: string[];
  metadata?: JsonObject;
  always?: string[];
  properties?: ControlEventProperties;
}): EventPermissionAsked =>
  ({
    id: `event-${input.requestId}`,
    type: "permission.asked",
    properties: {
      id: input.requestId,
      sessionID: input.sessionId ?? "external-session-1",
      permission: input.permission ?? "write",
      patterns: input.patterns ?? ["src/**"],
      metadata: input.metadata ?? {},
      always: input.always ?? [],
      ...input.properties,
    },
  }) satisfies EventPermissionAsked;

export const permissionV2AskedEvent = (input: {
  requestId: string;
  sessionId?: string;
  action?: string;
  resources?: string[];
  save?: string[];
  metadata?: JsonObject;
  properties?: ControlEventProperties;
}): EventPermissionV2Asked => {
  const properties: EventPermissionV2Asked["properties"] = {
    id: input.requestId,
    sessionID: input.sessionId ?? "external-session-1",
    action: input.action ?? "edit",
    resources: input.resources ?? ["src/**"],
  };
  if (input.save) {
    properties.save = input.save;
  }
  if (input.metadata) {
    properties.metadata = input.metadata;
  }
  if (input.properties) {
    Object.assign(properties, input.properties);
  }
  return {
    id: `event-${input.requestId}`,
    type: "permission.v2.asked",
    properties,
  } satisfies EventPermissionV2Asked;
};

export const permissionRepliedEvent = (input: {
  requestId: string;
  sessionId?: string;
  reply?: "once" | "always" | "reject";
  properties?: ControlEventProperties;
}): EventPermissionReplied =>
  ({
    id: `event-${input.requestId}-replied`,
    type: "permission.replied",
    properties: {
      sessionID: input.sessionId ?? "external-session-1",
      requestID: input.requestId,
      reply: input.reply ?? "once",
      ...input.properties,
    },
  }) satisfies EventPermissionReplied;

export const permissionV2RepliedEvent = (input: {
  requestId: string;
  sessionId?: string;
  reply?: EventPermissionV2Replied["properties"]["reply"];
}): EventPermissionV2Replied =>
  ({
    id: `event-${input.requestId}-v2-replied`,
    type: "permission.v2.replied",
    properties: {
      sessionID: input.sessionId ?? "external-session-1",
      requestID: input.requestId,
      reply: input.reply ?? "once",
    },
  }) satisfies EventPermissionV2Replied;

const defaultQuestion: QuestionInfo = {
  header: "Scope",
  question: "Pick target",
  options: [{ label: "A", description: "Option A" }],
};

export const questionAskedEvent = (input: {
  requestId: string;
  sessionId?: string;
  questions?: QuestionInfo[];
  properties?: ControlEventProperties;
}): EventQuestionAsked =>
  ({
    id: `event-${input.requestId}`,
    type: "question.asked",
    properties: {
      id: input.requestId,
      sessionID: input.sessionId ?? "external-session-1",
      questions: input.questions ?? [defaultQuestion],
      ...input.properties,
    },
  }) satisfies EventQuestionAsked;

export const questionV2AskedEvent = (input: {
  requestId: string;
  sessionId?: string;
  questions?: EventQuestionV2Asked["properties"]["questions"];
  properties?: ControlEventProperties;
}): EventQuestionV2Asked =>
  ({
    id: `event-${input.requestId}`,
    type: "question.v2.asked",
    properties: {
      id: input.requestId,
      sessionID: input.sessionId ?? "external-session-1",
      questions: input.questions ?? [defaultQuestion],
      ...input.properties,
    },
  }) satisfies EventQuestionV2Asked;

export const questionRepliedEvent = (input: {
  requestId: string;
  sessionId?: string;
  answers?: EventQuestionReplied["properties"]["answers"];
}): EventQuestionReplied =>
  ({
    id: `event-${input.requestId}-replied`,
    type: "question.replied",
    properties: {
      sessionID: input.sessionId ?? "external-session-1",
      requestID: input.requestId,
      answers: input.answers ?? [["A"]],
    },
  }) satisfies EventQuestionReplied;

export const questionV2RepliedEvent = (input: {
  requestId: string;
  sessionId?: string;
  answers?: EventQuestionV2Replied["properties"]["answers"];
}): EventQuestionV2Replied =>
  ({
    id: `event-${input.requestId}-v2-replied`,
    type: "question.v2.replied",
    properties: {
      sessionID: input.sessionId ?? "external-session-1",
      requestID: input.requestId,
      answers: input.answers ?? [["A"]],
    },
  }) satisfies EventQuestionV2Replied;

export const questionRejectedEvent = (input: {
  requestId: string;
  sessionId?: string;
}): EventQuestionRejected =>
  ({
    id: `event-${input.requestId}-rejected`,
    type: "question.rejected",
    properties: {
      sessionID: input.sessionId ?? "external-session-1",
      requestID: input.requestId,
    },
  }) satisfies EventQuestionRejected;

export const questionV2RejectedEvent = (input: {
  requestId: string;
  sessionId?: string;
}): EventQuestionV2Rejected =>
  ({
    id: `event-${input.requestId}-v2-rejected`,
    type: "question.v2.rejected",
    properties: {
      sessionID: input.sessionId ?? "external-session-1",
      requestID: input.requestId,
    },
  }) satisfies EventQuestionV2Rejected;

export const sessionStatusEvent = (
  status: SessionStatus,
  sessionId = "external-session-1",
  properties: ControlEventProperties = {},
): EventSessionStatus =>
  ({
    id: `event-status-${sessionId}`,
    type: "session.status",
    properties: { sessionID: sessionId, status, ...properties },
  }) satisfies EventSessionStatus;

export const malformedControlEvent = (
  type: MalformedControlEvent["type"],
  properties: ControlEventProperties,
): MalformedControlEvent => ({ id: `malformed-${type}`, type, properties });

export const makeClientWithEvents = (events: TestGlobalEventPayload[]): OpencodeClient => {
  return createOpencodeClient({
    baseUrl: "http://127.0.0.1:12345",
    fetch: () => {
      const streamedEvents = events.flatMap((rawEvent, index) => {
        const properties = z
          .object({ directory: z.string().optional() })
          .safeParse("properties" in rawEvent ? rawEvent.properties : undefined);
        const directory = properties.success ? (properties.data.directory ?? "/repo") : "/repo";
        const payloads =
          "type" in rawEvent && rawEvent.type === "sync"
            ? [{ ...rawEvent, id: rawEvent.id ?? `test-event-${index}` }]
            : createOpencodeEventFixtures(rawEvent, index);
        return payloads.map((payload) => ({
          directory,
          payload,
        }));
      });
      const body = streamedEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
      return Promise.resolve(
        new Response(body, { headers: { "content-type": "text/event-stream" } }),
      );
    },
  });
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
  const subscription: Parameters<typeof subscribeSessionToRuntimeEvents>[0] = {
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
  };
  if (options.logEvent) {
    subscription.logEvent = options.logEvent;
  }
  subscribeSessionToRuntimeEvents(subscription);
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
