import { describe, expect, test } from "bun:test";
import type { Event, Session } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { makeClientWithEvents, makeSessionInput } from "./event-stream.test-support";
import { registerSession } from "./session-registry";
import type { RuntimeEventTransportRecord, SessionRecord } from "./types";

type AssistantPartEvent = Extract<AgentEvent, { type: "assistant_part" }>;
type SubagentPart = Extract<AssistantPartEvent["part"], { kind: "subagent" }>;

const readSubagentParts = (events: AgentEvent[]): SubagentPart[] =>
  events
    .filter(
      (event): event is AssistantPartEvent =>
        event.type === "assistant_part" && event.part.kind === "subagent",
    )
    .map((event) => event.part as SubagentPart);

const assistantRoleEvent = (messageId: string): Event =>
  ({
    type: "message.updated",
    properties: {
      info: {
        id: messageId,
        role: "assistant",
        sessionID: "external-session-1",
      },
    },
  }) as unknown as Event;

const assistantSubtaskEvent = (input: {
  messageId: string;
  partId: string;
  description: string;
}): Event =>
  ({
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
  }) as unknown as Event;

const assistantTaskToolEvent = (input: {
  messageId: string;
  partId: string;
  description: string;
}): Event =>
  ({
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
  }) as unknown as Event;

const childPermissionEvent = (childSessionId: string): Event =>
  ({
    type: "permission.asked",
    properties: {
      sessionID: childSessionId,
      id: "permission-child-1",
      permission: "read",
      patterns: ["omp.json"],
    },
  }) as unknown as Event;

const syncAssistantSubtaskEvent = (input: {
  messageId: string;
  partId: string;
  description: string;
}): Event =>
  ({
    type: "sync",
    name: "message.part.updated.1",
    id: `sync-${input.partId}`,
    seq: 1,
    aggregateID: "sessionID",
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
  }) as unknown as Event;

const childSessionCreatedEvent = (childSessionId: string): Event =>
  ({
    type: "session.created",
    properties: {
      parentID: "external-session-1",
      info: {
        id: childSessionId,
        time: {
          created: Date.parse("2026-02-22T12:00:10.000Z"),
        },
      },
    },
  }) as unknown as Event;

const syncChildSessionCreatedEvent = (childSessionId: string): Event =>
  ({
    type: "sync",
    name: "session.created.1",
    id: `sync-${childSessionId}`,
    seq: 2,
    aggregateID: "sessionID",
    data: {
      sessionID: childSessionId,
      info: {
        id: childSessionId,
        parentID: "external-session-1",
        directory: "/repo",
        title: "Subagent",
        version: "1.0.0",
        time: {
          created: Date.parse("2026-02-22T12:00:10.000Z"),
          updated: Date.parse("2026-02-22T12:00:10.000Z"),
        },
      },
    },
  }) as unknown as Event;

const syncChildSessionCreatedEventWithoutParent = (childSessionId: string): Event =>
  ({
    type: "sync",
    name: "session.created.1",
    id: `sync-${childSessionId}`,
    seq: 2,
    aggregateID: "sessionID",
    data: {
      sessionID: childSessionId,
      info: {
        id: childSessionId,
        directory: "/repo",
        title: "Subagent",
        version: "1.0.0",
        time: {
          created: Date.parse("2026-02-22T12:00:10.000Z"),
          updated: Date.parse("2026-02-22T12:00:10.000Z"),
        },
      },
    },
  }) as unknown as Event;

const makeSessionChild = (id: string, parentID: string): Session =>
  ({
    id,
    slug: id,
    projectID: "project-1",
    directory: "/repo",
    parentID,
    title: "Subagent",
    version: "1.0.0",
    time: {
      created: Date.parse("2026-02-22T12:00:10.000Z"),
      updated: Date.parse("2026-02-22T12:00:10.000Z"),
    },
  }) as Session;

const makeSessionChildWithParentId = (id: string, parentId: string): Session =>
  ({
    id,
    slug: id,
    projectID: "project-1",
    directory: "/repo",
    parentId,
    title: "Subagent",
    version: "1.0.0",
    time: {
      created: Date.parse("2026-02-22T12:00:10.000Z"),
      updated: Date.parse("2026-02-22T12:00:10.000Z"),
    },
  }) as unknown as Session;

const runRuntimeEventTransport = async (
  events: Event[],
  options?: {
    childrenBySessionId?: Record<string, Session[]>;
  },
): Promise<AgentEvent[]> => {
  const client = makeClientWithEvents(events, options);
  const sessions = new Map<string, SessionRecord>();
  const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();
  const emitted: AgentEvent[] = [];

  registerSession({
    sessions,
    runtimeEventTransports,
    createClient: () => client,
    runtimeId: "runtime-opencode-1",
    runtimeEndpoint: "http://127.0.0.1:12345",
    externalSessionId: "external-session-1",
    sessionInput: makeSessionInput(),
    client,
    startedAt: "2026-02-22T12:00:00.000Z",
    startedMessage: "Started",
    emitStartedEvent: false,
    now: () => "2026-02-22T12:00:00.000Z",
    emit: (_externalSessionId, event) => {
      emitted.push(event);
    },
  });

  await runtimeEventTransports.get("runtime-opencode-1")?.streamDone;
  return emitted;
};

describe("session registry runtime event transport", () => {
  test("routes top-level parent child session creation to the single pending subagent card", async () => {
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

  test("routes parentless sync child session creation through session children lookup", async () => {
    const emitted = await runRuntimeEventTransport(
      [
        assistantRoleEvent("assistant-sync-subagent-session-created"),
        syncAssistantSubtaskEvent({
          messageId: "assistant-sync-subagent-session-created",
          partId: "subtask-a",
          description: "Read omp.json file",
        }),
        syncChildSessionCreatedEventWithoutParent("external-child-session"),
        childPermissionEvent("external-child-session"),
      ],
      {
        childrenBySessionId: {
          "external-session-1": [makeSessionChild("external-child-session", "external-session-1")],
        },
      },
    );

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts[1]).toMatchObject({
      correlationKey: "part:assistant-sync-subagent-session-created:subtask-a",
      externalSessionId: "external-child-session",
      status: "running",
    });

    const approvalEvents = emitted.filter((event) => event.type === "approval_required");
    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0]).toMatchObject({
      requestId: "permission-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-sync-subagent-session-created:subtask-a",
    });
  });

  test("resolves parentless child session events when session children use parentId", async () => {
    const emitted = await runRuntimeEventTransport(
      [
        assistantRoleEvent("assistant-sync-subagent-session-created"),
        syncAssistantSubtaskEvent({
          messageId: "assistant-sync-subagent-session-created",
          partId: "subtask-a",
          description: "Read omp.json file",
        }),
        syncChildSessionCreatedEventWithoutParent("external-child-session"),
        childPermissionEvent("external-child-session"),
      ],
      {
        childrenBySessionId: {
          "external-session-1": [
            makeSessionChildWithParentId("external-child-session", "external-session-1"),
          ],
        },
      },
    );

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts[1]).toMatchObject({
      correlationKey: "part:assistant-sync-subagent-session-created:subtask-a",
      externalSessionId: "external-child-session",
      status: "running",
    });

    const approvalEvents = emitted.filter((event) => event.type === "approval_required");
    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0]).toMatchObject({
      requestId: "permission-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-sync-subagent-session-created:subtask-a",
    });
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
});
