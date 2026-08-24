import { describe, expect, test } from "bun:test";
import type {
  Event,
  EventSessionDeleted,
  GlobalEvent,
  OpencodeClient,
  SyncEventMessagePartUpdated,
  SyncEventSessionDeleted,
  SyncEventSessionUpdated,
} from "@opencode-ai/sdk/v2/client";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import {
  childSessionCreatedEvent,
  childSessionCreatedEventWithParentAlias,
  childSessionInfo,
  makeClientWithEvents,
  makeSessionInput,
  makeSessionRecord,
  permissionAskedEvent,
  questionAskedEvent,
  runtimeSourceSyncChildSessionCreatedEvent,
  runtimeSourceSyncChildSessionCreatedEventWithParentAlias,
  syncChildSessionCreatedEvent,
} from "./event-stream.test-support";
import type { UnknownRecord } from "./guards";
import { observeRuntimeEvents, registerSession, releaseSessionRuntime } from "./session-registry";
import type { OpencodeEventLogger, RuntimeEventTransportRecord, SessionRecord } from "./types";
import { waitForUserMessageAdmission } from "./user-message-admission";

type GlobalEventPayload = UnknownRecord;
type AssistantPartEvent = Extract<AgentEvent, { type: "assistant_part" }>;
type SubagentPart = Extract<AssistantPartEvent["part"], { kind: "subagent" }>;
type SubagentPartEvent = AssistantPartEvent & { part: SubagentPart };

const readSubagentParts = (events: AgentEvent[]): SubagentPart[] =>
  events
    .filter(
      (event): event is SubagentPartEvent =>
        event.type === "assistant_part" && event.part.kind === "subagent",
    )
    .map((event) => event.part);

const assistantRoleEvent = (messageId: string): UnknownRecord => ({
  type: "message.updated",
  properties: {
    info: {
      id: messageId,
      role: "assistant",
      sessionID: "external-session-1",
    },
  },
});

const assistantSubtaskEvent = (input: {
  messageId: string;
  partId: string;
  description: string;
}): UnknownRecord => ({
  type: "message.part.updated",
  properties: {
    part: {
      id: input.partId,
      sessionID: "external-session-1",
      messageID: input.messageId,
      type: "subtask",
      agent: "build",
      prompt: "Inspect repo",
      description: input.description,
    },
  },
});

const assistantTaskToolEvent = (input: {
  messageId: string;
  partId: string;
  description: string;
}): UnknownRecord => ({
  type: "message.part.updated",
  properties: {
    part: {
      id: input.partId,
      sessionID: "external-session-1",
      messageID: input.messageId,
      type: "tool",
      callID: `call-${input.partId}`,
      tool: "task",
      state: {
        status: "running",
        input: {
          description: input.description,
          prompt: "Inspect repo",
          subagent_type: "explorer",
        },
        time: {
          start: Date.parse("2026-02-22T12:00:10.000Z"),
        },
      },
    },
  },
});

const childPermissionEvent = (childSessionId: string): Event =>
  permissionAskedEvent({
    requestId: "permission-child-1",
    sessionId: childSessionId,
    permission: "read",
    patterns: ["omp.json"],
  });

const childQuestionEvent = (childSessionId: string): Event =>
  questionAskedEvent({
    requestId: "question-child-1",
    sessionId: childSessionId,
    questions: [
      {
        header: "Scope",
        question: "Pick target",
        options: [{ label: "Current file", description: "Inspect only the requested file" }],
      },
    ],
  });

const syncAssistantSubtaskEvent = (input: {
  messageId: string;
  partId: string;
  description: string;
}): SyncEventMessagePartUpdated =>
  ({
    type: "sync",
    id: `sync-${input.partId}`,
    syncEvent: {
      type: "message.part.updated.1",
      id: `sync-event-${input.partId}`,
      seq: 1,
      aggregateID: "external-session-1",
      data: {
        sessionID: "external-session-1",
        time: Date.parse("2026-02-22T12:00:09.000Z"),
        part: {
          id: input.partId,
          sessionID: "external-session-1",
          messageID: input.messageId,
          type: "subtask",
          agent: "build",
          prompt: "Inspect repo",
          description: input.description,
        },
      },
    },
  }) satisfies SyncEventMessagePartUpdated;

const syncChildSessionCreatedEventWithoutParent = (childSessionId: string): GlobalEventPayload => {
  return {
    type: "sync",
    id: `sync-${childSessionId}`,
    syncEvent: {
      type: "session.created.1",
      id: `sync-event-${childSessionId}`,
      seq: 2,
      aggregateID: childSessionId,
      data: {
        sessionID: childSessionId,
        parentID: "external-session-1",
        info: {
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
        },
      },
    },
  };
};

const syncChildSessionUpdatedEvent = (childSessionId: string): SyncEventSessionUpdated =>
  ({
    type: "sync",
    id: `sync-updated-${childSessionId}`,
    syncEvent: {
      type: "session.updated.1",
      id: `sync-event-updated-${childSessionId}`,
      seq: 3,
      aggregateID: childSessionId,
      data: {
        sessionID: childSessionId,
        info: childSessionInfo(childSessionId, "external-session-1"),
      },
    },
  }) satisfies SyncEventSessionUpdated;

const syncChildSessionDeletedEvent = (
  childSessionId: string,
  parentID?: string,
): SyncEventSessionDeleted =>
  ({
    type: "sync",
    id: `sync-deleted-${childSessionId}`,
    syncEvent: {
      type: "session.deleted.1",
      id: `sync-event-deleted-${childSessionId}`,
      seq: 4,
      aggregateID: childSessionId,
      data: {
        sessionID: childSessionId,
        info: childSessionInfo(childSessionId, parentID),
      },
    },
  }) satisfies SyncEventSessionDeleted;

const malformedSyncLifecycleDataEvent = (): GlobalEventPayload => ({
  type: "sync",
  id: "sync-malformed-session-created",
  syncEvent: {
    type: "session.created.1",
    id: "sync-event-malformed-session-created",
    seq: 1,
    aggregateID: "external-child-session",
    data: null,
  },
});

const childSessionDeletedEvent = (childSessionId: string): EventSessionDeleted =>
  ({
    id: `event-deleted-${childSessionId}`,
    type: "session.deleted",
    properties: {
      sessionID: childSessionId,
      info: childSessionInfo(childSessionId, "external-session-1"),
    },
  }) satisfies EventSessionDeleted;

const childSessionDeletedEventWithoutParent = (sessionId: string): EventSessionDeleted =>
  ({
    id: `event-deleted-${sessionId}-without-parent`,
    type: "session.deleted",
    properties: {
      sessionID: sessionId,
      info: childSessionInfo(sessionId),
    },
  }) satisfies EventSessionDeleted;

const makeLiveClient = (): OpencodeClient => {
  const connectedPayload = {
    id: "event-server-connected",
    type: "server.connected",
    properties: {},
  } satisfies Extract<GlobalEventPayload, { type: "server.connected" }>;

  const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:12345" });
  return {
    ...baseClient,
    global: {
      ...baseClient.global,
      event: async (options?: { signal?: AbortSignal }) => {
        async function* iterator(): AsyncGenerator<GlobalEvent> {
          yield {
            directory: "/repo",
            payload: connectedPayload,
          };
          if (options?.signal?.aborted) {
            return;
          }
          await new Promise<void>((resolve) => {
            options?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        return { stream: iterator() };
      },
    },
  };
};

const runRuntimeEventTransport = async (
  events: GlobalEventPayload[],
  options?: {
    onTransport?: (transport: RuntimeEventTransportRecord) => void;
    externalSessionIds?: string[];
    logEvent?: OpencodeEventLogger;
  },
): Promise<AgentEvent[]> => {
  const client = makeClientWithEvents(events);
  const sessions = new Map<string, SessionRecord>();
  const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();
  const emitted: AgentEvent[] = [];

  for (const externalSessionId of options?.externalSessionIds ?? ["external-session-1"]) {
    registerSession({
      sessions,
      runtimeEventTransports,
      createClient: () => client,
      runtimeId: "runtime-opencode-1",
      runtimeEndpoint: "http://127.0.0.1:12345",
      externalSessionId,
      sessionInput: makeSessionInput(),
      client,
      startedAt: "2026-02-22T12:00:00.000Z",
      startedMessage: "Started",
      emitStartedEvent: false,
      now: () => "2026-02-22T12:00:00.000Z",
      emit: (_externalSessionId, event) => {
        emitted.push(event);
      },
      ...(options?.logEvent ? { logEvent: options.logEvent } : undefined),
    });
  }

  const transport = runtimeEventTransports.get("runtime-opencode-1");
  if (!transport) {
    throw new Error("Expected OpenCode runtime event transport.");
  }
  options?.onTransport?.(transport);
  await transport.streamDone;
  return emitted;
};

describe("session registry runtime event transport", () => {
  test("rejects pending message admission when its session is released", async () => {
    const session = makeSessionRecord(makeClientWithEvents([]));
    const sessions = new Map<string, SessionRecord>([[session.externalSessionId, session]]);
    const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();
    const admission = waitForUserMessageAdmission(session, "message-1");
    const settledAdmission = admission.promise.then(
      () => null,
      (cause: unknown) => cause,
    );

    await releaseSessionRuntime(session, sessions, runtimeEventTransports);

    await expect(settledAdmission).resolves.toEqual(
      new Error("OpenCode session 'external-session-1' was released."),
    );
  });

  test("keeps other sessions live after one session receives an unsupported status", async () => {
    const emitted = await runRuntimeEventTransport(
      [
        {
          id: "event-status-external-session-1",
          type: "session.status",
          properties: {
            sessionID: "external-session-1",
            status: { type: "reconnect" },
          },
        },
        {
          id: "event-status-external-session-2",
          type: "session.status",
          properties: {
            sessionID: "external-session-2",
            status: { type: "busy" },
          },
        },
      ],
      { externalSessionIds: ["external-session-1", "external-session-2"] },
    );

    expect(emitted.filter((event) => event.type === "session_error")).toEqual([
      expect.objectContaining({
        externalSessionId: "external-session-1",
        message: expect.stringContaining("session.status"),
      }),
    ]);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_status",
        externalSessionId: "external-session-2",
        status: { type: "busy", message: null },
      }),
    );
  });

  test("attributes a subscriber projection failure to that subscriber", async () => {
    const emitted = await runRuntimeEventTransport(
      [
        {
          id: "event-status-external-session-1",
          type: "session.status",
          properties: {
            sessionID: "external-session-1",
            status: { type: "busy" },
          },
        },
      ],
      {
        externalSessionIds: ["external-session-1", "external-session-2"],
        logEvent: ({ externalSessionId }) => {
          if (externalSessionId === "external-session-2") {
            throw new Error("Subscriber 2 projection failed.");
          }
        },
      },
    );

    expect(emitted.filter((event) => event.type === "session_error")).toEqual([
      expect.objectContaining({
        externalSessionId: "external-session-2",
        message: "Subscriber 2 projection failed.",
      }),
    ]);
  });

  test("terminates runtime observation when an event failure has no safe session owner", async () => {
    const terminalFailures: Error[] = [];

    await expect(
      runRuntimeEventTransport(
        [
          {
            type: "session.created",
            properties: { info: {} },
          },
        ],
        {
          externalSessionIds: ["external-session-1", "external-session-2"],
          onTransport: (transport) => {
            transport.terminalObservers.add((error) => {
              terminalFailures.push(error);
            });
          },
        },
      ),
    ).rejects.toThrow();
    expect(terminalFailures).toHaveLength(1);
    expect(terminalFailures[0]?.message).toContain("session.created");
  });

  test("routes direct child session creation to the single pending subagent card", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-subagent-session-created"),
      assistantSubtaskEvent({
        messageId: "assistant-subagent-session-created",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      childSessionCreatedEvent("external-child-session"),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts[1]).toMatchObject({
      correlationKey: "part:assistant-subagent-session-created:subtask-a",
      externalSessionId: "external-child-session",
      status: "running",
    });
  });

  test("routes task tool child session creation to the pending subagent card", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-tool-subagent-session-created"),
      assistantTaskToolEvent({
        messageId: "assistant-tool-subagent-session-created",
        partId: "tool-task-a",
        description: "Read omp.json file",
      }),
      childSessionCreatedEvent("external-child-session"),
      childPermissionEvent("external-child-session"),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts[1]).toMatchObject({
      correlationKey: "part:assistant-tool-subagent-session-created:tool-task-a",
      externalSessionId: "external-child-session",
      status: "running",
    });

    const approvalEvents = emitted.filter((event) => event.type === "approval_required");
    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0]).toMatchObject({
      requestId: "permission-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-tool-subagent-session-created:tool-task-a",
    });
  });

  test("routes sync child session creation to the single pending subagent card", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-sync-subagent-session-created"),
      syncAssistantSubtaskEvent({
        messageId: "assistant-sync-subagent-session-created",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      syncChildSessionCreatedEvent("external-child-session"),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts[1]).toMatchObject({
      correlationKey: "part:assistant-sync-subagent-session-created:subtask-a",
      externalSessionId: "external-child-session",
      status: "running",
    });
  });

  test("routes the runtime-source nested sync shape without an outer id", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-runtime-source-sync-session-created"),
      syncAssistantSubtaskEvent({
        messageId: "assistant-runtime-source-sync-session-created",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      runtimeSourceSyncChildSessionCreatedEvent("external-child-session"),
      childPermissionEvent("external-child-session"),
    ]);

    expect(emitted.filter((event) => event.type === "approval_required")).toContainEqual(
      expect.objectContaining({
        childExternalSessionId: "external-child-session",
        parentExternalSessionId: "external-session-1",
      }),
    );
  });

  test("routes parentless child input after a sync session update confirms lineage", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-sync-subagent-session-updated"),
      syncAssistantSubtaskEvent({
        messageId: "assistant-sync-subagent-session-updated",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      syncChildSessionUpdatedEvent("external-child-session"),
      childPermissionEvent("external-child-session"),
    ]);

    expect(emitted.filter((event) => event.type === "approval_required")).toContainEqual(
      expect.objectContaining({
        childExternalSessionId: "external-child-session",
        parentExternalSessionId: "external-session-1",
      }),
    );
  });

  test("rejects whitespace-only direct child lineage without recording it", async () => {
    let transport: RuntimeEventTransportRecord | undefined;
    const emitted = await runRuntimeEventTransport(
      [childSessionCreatedEvent("external-child-session", "   ")],
      {
        onTransport: (record) => {
          transport = record;
        },
      },
    );

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("info.parentID"),
      }),
    );
    expect(
      transport?.parentExternalSessionIdByChildExternalSessionId.has("external-child-session"),
    ).toBe(false);
  });

  test("rejects whitespace-only nested sync child lineage without recording it", async () => {
    let transport: RuntimeEventTransportRecord | undefined;
    const emitted = await runRuntimeEventTransport(
      [runtimeSourceSyncChildSessionCreatedEvent("external-child-session", "   ")],
      {
        onTransport: (record) => {
          transport = record;
        },
      },
    );

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("info.parentID"),
      }),
    );
    expect(
      transport?.parentExternalSessionIdByChildExternalSessionId.has("external-child-session"),
    ).toBe(false);
  });

  test("rejects direct child lifecycle parentId aliases without recording lineage", async () => {
    let transport: RuntimeEventTransportRecord | undefined;
    const emitted = await runRuntimeEventTransport(
      [
        childSessionCreatedEventWithParentAlias("external-child-session", "parentId"),
        childPermissionEvent("external-child-session"),
      ],
      {
        onTransport: (record) => {
          transport = record;
        },
      },
    );

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("info.parentID"),
      }),
    );
    expect(
      transport?.parentExternalSessionIdByChildExternalSessionId.has("external-child-session"),
    ).toBe(false);
  });

  test("rejects runtime-source nested parent_id aliases without recording lineage", async () => {
    let transport: RuntimeEventTransportRecord | undefined;
    const emitted = await runRuntimeEventTransport(
      [
        runtimeSourceSyncChildSessionCreatedEventWithParentAlias(
          "external-child-session",
          "parent_id",
        ),
        childPermissionEvent("external-child-session"),
      ],
      {
        onTransport: (record) => {
          transport = record;
        },
      },
    );

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("info.parentID"),
      }),
    );
    expect(
      transport?.parentExternalSessionIdByChildExternalSessionId.has("external-child-session"),
    ).toBe(false);
  });

  test("reports sync child lifecycle events that omit info.parentID", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-sync-subagent-session-created"),
      syncAssistantSubtaskEvent({
        messageId: "assistant-sync-subagent-session-created",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      syncChildSessionCreatedEventWithoutParent("external-child-session"),
    ]);

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("info.parentID"),
      }),
    );
  });

  test("reports recognized sync lifecycle events with malformed data", async () => {
    const emitted = await runRuntimeEventTransport([malformedSyncLifecycleDataEvent()]);

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("syncEvent.data"),
      }),
    );
  });

  test("routes known child permission events after the child session link is established", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-subagent-permission"),
      assistantSubtaskEvent({
        messageId: "assistant-subagent-permission",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      childSessionCreatedEvent("external-child-session"),
      childPermissionEvent("external-child-session"),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts[1]).toMatchObject({
      correlationKey: "part:assistant-subagent-permission:subtask-a",
      externalSessionId: "external-child-session",
    });

    const approvalEvents = emitted.filter((event) => event.type === "approval_required");
    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0]).toMatchObject({
      requestId: "permission-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-subagent-permission:subtask-a",
    });
  });

  test("routes later parentless child question events from confirmed lifecycle lineage", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-subagent-question"),
      assistantSubtaskEvent({
        messageId: "assistant-subagent-question",
        partId: "subtask-a",
        description: "Ask for scope",
      }),
      childSessionCreatedEvent("external-child-session"),
      childQuestionEvent("external-child-session"),
    ]);

    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0]).toMatchObject({
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-subagent-question:subtask-a",
    });
  });

  test("stops routing a child after session deletion clears confirmed lineage", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-subagent-deleted"),
      assistantSubtaskEvent({
        messageId: "assistant-subagent-deleted",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      childSessionCreatedEvent("external-child-session"),
      childSessionDeletedEvent("external-child-session"),
      childPermissionEvent("external-child-session"),
    ]);

    expect(emitted.filter((event) => event.type === "approval_required")).toHaveLength(0);
  });

  test("reports confirmed child deletion when info.parentID is missing", async () => {
    const emitted = await runRuntimeEventTransport([
      childSessionCreatedEvent("external-child-session"),
      childSessionDeletedEventWithoutParent("external-child-session"),
    ]);

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("info.parentID"),
      }),
    );
  });

  test("accepts root session deletion without parent lineage", async () => {
    const emitted = await runRuntimeEventTransport([
      childSessionDeletedEventWithoutParent("external-root-session"),
    ]);

    expect(emitted.filter((event) => event.type === "session_error")).toHaveLength(0);
  });

  test("clears confirmed lineage after nested session deletion", async () => {
    const emitted = await runRuntimeEventTransport([
      syncChildSessionCreatedEvent("external-child-session"),
      syncChildSessionDeletedEvent("external-child-session", "external-session-1"),
      childPermissionEvent("external-child-session"),
    ]);

    expect(emitted.filter((event) => event.type === "approval_required")).toHaveLength(0);
  });

  test("reports nested confirmed child deletion when info.parentID is missing", async () => {
    const emitted = await runRuntimeEventTransport([
      syncChildSessionCreatedEvent("external-child-session"),
      syncChildSessionDeletedEvent("external-child-session"),
    ]);

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        message: expect.stringContaining("info.parentID"),
      }),
    );
  });

  test("clears confirmed child lineage when the runtime transport ends", async () => {
    let transport: RuntimeEventTransportRecord | undefined;
    await runRuntimeEventTransport([childSessionCreatedEvent("external-child-session")], {
      onTransport: (record) => {
        transport = record;
      },
    });

    expect(transport?.parentExternalSessionIdByChildExternalSessionId.size).toBe(0);
  });

  test("explicit release clears, aborts, detaches, and permits same-runtime reuse", async () => {
    const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();
    const sessions = new Map<string, SessionRecord>();
    let clientCount = 0;
    const observe = () =>
      observeRuntimeEvents({
        runtimeEventTransports,
        createClient: () => {
          clientCount += 1;
          return makeLiveClient();
        },
        runtimeId: "runtime-opencode-1",
        runtimeEndpoint: "http://127.0.0.1:12345",
        sessions,
        now: () => "2026-02-22T12:00:00.000Z",
        emit: () => undefined,
        observer: () => undefined,
        terminalObserver: () => undefined,
      });

    const firstObservation = await observe();
    const firstTransport = runtimeEventTransports.get("runtime-opencode-1");
    if (!firstTransport) {
      throw new Error("Expected first OpenCode runtime event transport.");
    }
    await firstObservation.dispatch(childSessionCreatedEvent("external-child-session"));
    expect(
      firstTransport.parentExternalSessionIdByChildExternalSessionId.get("external-child-session"),
    ).toBe("external-session-1");

    await firstObservation.release();
    await firstTransport.streamDone;
    expect(firstTransport.controller.signal.aborted).toBe(true);
    expect(firstTransport.parentExternalSessionIdByChildExternalSessionId.size).toBe(0);
    expect(runtimeEventTransports.has("runtime-opencode-1")).toBe(false);

    const secondObservation = await observe();
    const secondTransport = runtimeEventTransports.get("runtime-opencode-1");
    if (!secondTransport) {
      throw new Error("Expected replacement OpenCode runtime event transport.");
    }
    expect(secondTransport).not.toBe(firstTransport);
    expect(clientCount).toBe(2);

    await secondObservation.release();
    await secondTransport.streamDone;
  });
});
