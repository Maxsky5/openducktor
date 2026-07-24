import { describe, expect, test } from "bun:test";
import type { Event } from "@opencode-ai/sdk/v2/client";
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

const childQuestionEvent = (childSessionId: string): Event =>
  ({
    type: "question.asked",
    properties: {
      sessionID: childSessionId,
      id: "question-child-1",
      questions: [
        {
          header: "Scope",
          question: "Pick target",
          options: [{ label: "Current file", description: "Inspect only the requested file" }],
        },
      ],
    },
  }) as unknown as Event;

const syncAssistantSubtaskEvent = (input: {
  messageId: string;
  partId: string;
  description: string;
}): Event =>
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
  }) as unknown as Event;

const childSessionCreatedEvent = (childSessionId: string): Event =>
  ({
    type: "session.created",
    properties: {
      sessionID: childSessionId,
      info: {
        id: childSessionId,
        slug: childSessionId,
        projectID: "project-1",
        directory: "/repo",
        parentID: "external-session-1",
        title: "Subagent",
        version: "1.0.0",
        time: {
          created: Date.parse("2026-02-22T12:00:10.000Z"),
          updated: Date.parse("2026-02-22T12:00:10.000Z"),
        },
      },
    },
  }) as unknown as Event;

const syncChildSessionCreatedEvent = (childSessionId: string): Event =>
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
        info: {
          id: childSessionId,
          slug: childSessionId,
          projectID: "project-1",
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
    },
  }) as unknown as Event;

const syncChildSessionCreatedEventWithoutParent = (childSessionId: string): Event =>
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
  }) as unknown as Event;

const childSessionDeletedEvent = (childSessionId: string): Event =>
  ({
    type: "session.deleted",
    properties: {
      sessionID: childSessionId,
      info: {
        id: childSessionId,
        slug: childSessionId,
        projectID: "project-1",
        directory: "/repo",
        parentID: "external-session-1",
        title: "Subagent",
        version: "1.0.0",
        time: {
          created: Date.parse("2026-02-22T12:00:10.000Z"),
          updated: Date.parse("2026-02-22T12:00:11.000Z"),
        },
      },
    },
  }) as unknown as Event;

const runRuntimeEventTransport = async (
  events: Event[],
  options?: {
    onTransport?: (transport: RuntimeEventTransportRecord) => void;
  },
): Promise<AgentEvent[]> => {
  const client = makeClientWithEvents(events);
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

  const transport = runtimeEventTransports.get("runtime-opencode-1");
  if (!transport) {
    throw new Error("Expected OpenCode runtime event transport.");
  }
  options?.onTransport?.(transport);
  await transport.streamDone;
  return emitted;
};

describe("session registry runtime event transport", () => {
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

  test("clears confirmed child lineage when the runtime transport ends", async () => {
    let transport: RuntimeEventTransportRecord | undefined;
    await runRuntimeEventTransport([childSessionCreatedEvent("external-child-session")], {
      onTransport: (record) => {
        transport = record;
      },
    });

    const lineage = (
      transport as RuntimeEventTransportRecord & {
        parentExternalSessionIdByChildExternalSessionId: Map<string, string>;
      }
    ).parentExternalSessionIdByChildExternalSessionId;
    expect(lineage.size).toBe(0);
  });
});
