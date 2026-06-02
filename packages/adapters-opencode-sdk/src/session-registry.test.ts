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

const runRuntimeEventTransport = async (events: Event[]): Promise<AgentEvent[]> => {
  const client = makeClientWithEvents(events);
  const sessions = new Map<string, SessionRecord>();
  const runtimeEventTransports = new Map<string, RuntimeEventTransportRecord>();
  const emitted: AgentEvent[] = [];

  registerSession({
    sessions,
    runtimeEventTransports,
    createClient: () => client,
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

  await runtimeEventTransports.get("http://127.0.0.1:12345")?.streamDone;
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

  test("routes same-directory child permission events to the single pending subagent card", async () => {
    const emitted = await runRuntimeEventTransport([
      assistantRoleEvent("assistant-subagent-permission"),
      assistantSubtaskEvent({
        messageId: "assistant-subagent-permission",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
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
