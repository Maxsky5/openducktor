import { describe, expect, test } from "bun:test";
import type { Event } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { runEventStreamWithSession } from "./event-stream.test-support";

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

const makeAssistantSubtaskPartUpdatedEvent = (input: {
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

const makeChildSessionCreatedEvent = (input: {
  childSessionId: string;
  parentExternalSessionId?: string;
  createdAtMs?: number;
}): Event =>
  ({
    type: "session.created",
    properties: {
      sessionID: input.childSessionId,
      info: {
        id: input.childSessionId,
        parentID: input.parentExternalSessionId ?? "external-session-1",
        time: {
          created: input.createdAtMs ?? Date.parse("2026-02-22T12:00:10.000Z"),
        },
      },
    },
  }) as unknown as Event;

const makeChildPermissionAskedEvent = (input: {
  childSessionId: string;
  parentExternalSessionId?: string;
  requestId?: string;
}): Event =>
  ({
    type: "permission.asked",
    properties: {
      sessionID: input.childSessionId,
      ...(input.parentExternalSessionId
        ? {
            info: {
              parentID: input.parentExternalSessionId,
            },
          }
        : {}),
      id: input.requestId ?? "permission-child-1",
      permission: "read",
      patterns: ["omp.json"],
    },
  }) as unknown as Event;

const makeChildQuestionAskedEvent = (input: {
  childSessionId: string;
  parentExternalSessionId?: string;
  requestId?: string;
}): Event =>
  ({
    type: "question.asked",
    properties: {
      sessionID: input.childSessionId,
      ...(input.parentExternalSessionId
        ? {
            info: {
              parentID: input.parentExternalSessionId,
            },
          }
        : {}),
      id: input.requestId ?? "question-child-1",
      questions: [
        {
          id: "scope",
          label: "Scope",
          options: ["current file", "whole repo"],
        },
      ],
    },
  }) as unknown as Event;

const makeSubagentToolPartUpdatedEvent = (input: {
  messageId: string;
  partId: string;
  callId: string;
  tool: "delegate" | "task";
  status: "running" | "completed";
  childSessionId?: string;
  result?: string;
  metadataOnly?: boolean;
}): Event => {
  const subagentIdentity = {
    agent: "build",
    prompt: "Inspect repo",
    ...(input.childSessionId ? { externalSessionId: input.childSessionId } : {}),
  };
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: input.partId,
        sessionID: "external-session-1",
        messageID: input.messageId,
        callID: input.callId,
        type: "tool",
        tool: input.tool,
        state: {
          status: input.status,
          ...(input.metadataOnly
            ? { metadata: subagentIdentity }
            : {
                input:
                  input.tool === "task"
                    ? { subagent_type: "build", prompt: "Inspect repo", description: "Starting A" }
                    : { agent: "build", prompt: "Inspect repo" },
                output: input.childSessionId
                  ? {
                      result: input.result ?? `Finished ${input.childSessionId}`,
                      externalSessionId: input.childSessionId,
                    }
                  : undefined,
                ...(input.tool === "task" && input.childSessionId
                  ? { metadata: { externalSessionId: input.childSessionId } }
                  : {}),
              }),
        },
      },
    },
  } as unknown as Event;
};

describe("event-stream subagent correlation", () => {
  test("binds same-turn sibling subagents to child sessions without fragmenting their cards", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-collision"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-collision",
        partId: "subtask-a",
        description: "Starting A",
      }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-collision",
        partId: "subtask-b",
        description: "Starting B",
      }),
      makeChildSessionCreatedEvent({ childSessionId: "child-a" }),
      makeChildSessionCreatedEvent({ childSessionId: "child-b" }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-subagent-collision",
        partId: "tool-a",
        callId: "call-a",
        tool: "delegate",
        status: "completed",
        childSessionId: "child-a",
        result: "Finished A",
      }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-subagent-collision",
        partId: "tool-b",
        callId: "call-b",
        tool: "delegate",
        status: "completed",
        childSessionId: "child-b",
        result: "Finished B",
      }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    const runningParts = subagentParts.filter((part) => part.status === "running");
    const completedParts = subagentParts.filter((part) => part.status === "completed");

    expect(subagentParts).toHaveLength(6);
    expect(runningParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-subagent-collision:subtask-a",
      "part:assistant-subagent-collision:subtask-b",
      "part:assistant-subagent-collision:subtask-a",
      "part:assistant-subagent-collision:subtask-b",
    ]);
    expect(runningParts.map((part) => part.externalSessionId)).toEqual([
      undefined,
      undefined,
      "child-a",
      "child-b",
    ]);
    expect(completedParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-subagent-collision:subtask-a",
      "part:assistant-subagent-collision:subtask-b",
    ]);
    expect(completedParts.map((part) => part.externalSessionId)).toEqual(["child-a", "child-b"]);
    expect(completedParts.map((part) => part.description)).toEqual(["Finished A", "Finished B"]);
  });

  test("keeps ambiguous sibling completions bound to their original cards when they finish out of order", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-out-of-order"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-out-of-order",
        partId: "subtask-a",
        description: "Starting A",
      }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-out-of-order",
        partId: "subtask-b",
        description: "Starting B",
      }),
      makeChildSessionCreatedEvent({ childSessionId: "child-a" }),
      makeChildSessionCreatedEvent({ childSessionId: "child-b" }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-subagent-out-of-order",
        partId: "tool-b",
        callId: "call-b",
        tool: "delegate",
        status: "completed",
        childSessionId: "child-b",
        result: "Finished B",
      }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-subagent-out-of-order",
        partId: "tool-a",
        callId: "call-a",
        tool: "delegate",
        status: "completed",
        childSessionId: "child-a",
        result: "Finished A",
      }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    const runningParts = subagentParts.filter((part) => part.status === "running");
    const completedParts = subagentParts.filter((part) => part.status === "completed");

    expect(subagentParts).toHaveLength(6);
    expect(runningParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-subagent-out-of-order:subtask-a",
      "part:assistant-subagent-out-of-order:subtask-b",
      "part:assistant-subagent-out-of-order:subtask-a",
      "part:assistant-subagent-out-of-order:subtask-b",
    ]);
    expect(completedParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-subagent-out-of-order:subtask-b",
      "part:assistant-subagent-out-of-order:subtask-a",
    ]);
    expect(completedParts.map((part) => part.externalSessionId)).toEqual(["child-b", "child-a"]);
    expect(completedParts.map((part) => part.description)).toEqual(["Finished B", "Finished A"]);
  });

  test("binds running task tool updates with metadata session ids back to their spawned card", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-task-tool-running"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-task-tool-running",
        partId: "subtask-a",
        description: "Starting A",
      }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-task-tool-running",
        partId: "tool-a",
        callId: "call-a",
        tool: "task",
        status: "running",
        childSessionId: "child-a",
      }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-task-tool-running:subtask-a",
      "part:assistant-task-tool-running:subtask-a",
    ]);
    expect(subagentParts.map((part) => part.externalSessionId)).toEqual([undefined, "child-a"]);
    expect(subagentParts.map((part) => part.agent)).toEqual(["build", "build"]);
  });

  test("clears pending subagent queues once a running task tool update gains a session id", async () => {
    const { sessionRecord } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-task-tool-running"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-task-tool-running",
        partId: "subtask-a",
        description: "Starting A",
      }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-task-tool-running",
        partId: "tool-a",
        callId: "call-a",
        tool: "task",
        status: "running",
        childSessionId: "child-a",
      }),
    ]);

    expect(sessionRecord.subagentCorrelationKeyByExternalSessionId.get("child-a")).toBe(
      "part:assistant-task-tool-running:subtask-a",
    );
    expect(
      sessionRecord.subagentPartIdByCorrelationKey.get(
        "part:assistant-task-tool-running:subtask-a",
      ),
    ).toBe("tool-a");
    expect(sessionRecord.subagentPartIdByExternalSessionId.get("child-a")).toBe("tool-a");
    expect(sessionRecord.pendingSubagentCorrelationKeys).toEqual([]);
    expect(sessionRecord.pendingSubagentCorrelationKeysBySignature.size).toBe(0);
  });

  test("binds sibling child sessions correctly when session.created arrives out of order", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-created-order"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-created-order",
        partId: "subtask-a",
        description: "Starting A",
      }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-created-order",
        partId: "subtask-b",
        description: "Starting B",
      }),
      makeChildSessionCreatedEvent({
        childSessionId: "child-b",
        createdAtMs: Date.parse("2026-02-22T12:00:12.000Z"),
      }),
      makeChildSessionCreatedEvent({
        childSessionId: "child-a",
        createdAtMs: Date.parse("2026-02-22T12:00:10.000Z"),
      }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-subagent-created-order",
        partId: "tool-a",
        callId: "call-a",
        tool: "delegate",
        status: "completed",
        childSessionId: "child-a",
        result: "Finished A",
      }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-subagent-created-order",
        partId: "tool-b",
        callId: "call-b",
        tool: "delegate",
        status: "completed",
        childSessionId: "child-b",
        result: "Finished B",
      }),
    ]);

    const completedParts = readSubagentParts(emitted).filter((part) => part.status === "completed");
    expect(completedParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-subagent-created-order:subtask-a",
      "part:assistant-subagent-created-order:subtask-b",
    ]);
    expect(completedParts.map((part) => part.externalSessionId)).toEqual(["child-a", "child-b"]);
  });

  test("emits a linked subagent update when child session creation binds a running card", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-session-created"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-session-created",
        partId: "subtask-a",
        description: "Starting A",
      }),
      makeChildSessionCreatedEvent({ childSessionId: "external-child-session" }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-subagent-session-created:subtask-a",
      "part:assistant-subagent-session-created:subtask-a",
    ]);
    expect(subagentParts.map((part) => part.externalSessionId)).toEqual([
      undefined,
      "external-child-session",
    ]);
    expect(
      sessionRecord.subagentPartIdByCorrelationKey.get(
        "part:assistant-subagent-session-created:subtask-a",
      ),
    ).toBe("subtask-a");
    expect(sessionRecord.subagentPartIdByExternalSessionId.get("external-child-session")).toBe(
      "subtask-a",
    );
  });

  test("binds child permission events to the single running subagent card without a parent hint", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-permission"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-permission",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      makeChildPermissionAskedEvent({ childSessionId: "external-child-session" }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts.map((part) => part.externalSessionId)).toEqual([
      undefined,
      "external-child-session",
    ]);
    expect(subagentParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-subagent-permission:subtask-a",
      "part:assistant-subagent-permission:subtask-a",
    ]);

    const approvalEvents = emitted.filter((event) => event.type === "approval_required");
    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0]).toMatchObject({
      requestId: "permission-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-subagent-permission:subtask-a",
    });
    expect(
      sessionRecord.subagentPartIdByCorrelationKey.get(
        "part:assistant-subagent-permission:subtask-a",
      ),
    ).toBe("subtask-a");
    expect(sessionRecord.subagentPartIdByExternalSessionId.get("external-child-session")).toBe(
      "subtask-a",
    );
  });

  test("binds child question events to the single running subagent card without a parent hint", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-question"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-question",
        partId: "subtask-a",
        description: "Ask for scope",
      }),
      makeChildQuestionAskedEvent({ childSessionId: "external-child-session" }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts[1]).toMatchObject({
      correlationKey: "part:assistant-subagent-question:subtask-a",
      externalSessionId: "external-child-session",
    });

    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0]).toMatchObject({
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-subagent-question:subtask-a",
    });
  });

  test("does not guess child permission ownership when multiple subagent cards are pending", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-ambiguous-permission"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-ambiguous-permission",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-ambiguous-permission",
        partId: "subtask-b",
        description: "Read package.json file",
      }),
      makeChildPermissionAskedEvent({ childSessionId: "external-child-session" }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(2);
    expect(subagentParts.map((part) => part.externalSessionId)).toEqual([undefined, undefined]);
    expect(emitted.filter((event) => event.type === "approval_required")).toHaveLength(0);
    expect(
      sessionRecord.subagentCorrelationKeyByExternalSessionId.has("external-child-session"),
    ).toBe(false);
  });

  test("binds a child session that is created before the parent subagent card appears", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-created-first"),
      makeChildSessionCreatedEvent({ childSessionId: "external-child-session" }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-created-first",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
      makeChildPermissionAskedEvent({ childSessionId: "external-child-session" }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(1);
    expect(subagentParts[0]).toMatchObject({
      correlationKey: "part:assistant-subagent-created-first:subtask-a",
      externalSessionId: "external-child-session",
      status: "running",
    });

    const approvalEvents = emitted.filter((event) => event.type === "approval_required");
    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0]).toMatchObject({
      requestId: "permission-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-subagent-created-first:subtask-a",
    });
    expect(
      sessionRecord.subagentPartIdByCorrelationKey.get(
        "part:assistant-subagent-created-first:subtask-a",
      ),
    ).toBe("subtask-a");
    expect(sessionRecord.subagentPartIdByExternalSessionId.get("external-child-session")).toBe(
      "subtask-a",
    );
  });

  test("keeps child permissions relevant when they arrive before the parent subagent card", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-permission-first"),
      makeChildSessionCreatedEvent({ childSessionId: "external-child-session" }),
      makeChildPermissionAskedEvent({ childSessionId: "external-child-session" }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-permission-first",
        partId: "subtask-a",
        description: "Read omp.json file",
      }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(1);
    expect(subagentParts[0]).toMatchObject({
      correlationKey: "part:assistant-subagent-permission-first:subtask-a",
      externalSessionId: "external-child-session",
      status: "running",
    });

    const approvalEvents = emitted.filter((event) => event.type === "approval_required");
    expect(approvalEvents).toHaveLength(2);
    expect(approvalEvents[0]).toMatchObject({
      requestId: "permission-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
    });
    expect(approvalEvents[0]).not.toHaveProperty("subagentCorrelationKey");
    expect(approvalEvents[1]).toMatchObject({
      requestId: "permission-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-subagent-permission-first:subtask-a",
    });
  });

  test("keeps a completed linked subagent completed when child session creation arrives later", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-late-created"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-late-created",
        partId: "subtask-a",
        description: "Starting A",
      }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-subagent-late-created",
        partId: "tool-a",
        callId: "call-a",
        tool: "delegate",
        status: "completed",
        childSessionId: "child-a",
        result: "Finished A",
      }),
      makeChildSessionCreatedEvent({ childSessionId: "child-a" }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts.map((part) => part.status)).toEqual(["running", "completed", "completed"]);
    expect(subagentParts.map((part) => part.externalSessionId)).toEqual([
      undefined,
      "child-a",
      "child-a",
    ]);
    expect(
      sessionRecord.subagentPartIdByCorrelationKey.get(
        "part:assistant-subagent-late-created:subtask-a",
      ),
    ).toBe("tool-a");
    expect(sessionRecord.subagentPartIdByExternalSessionId.get("child-a")).toBe("tool-a");
  });

  test("defers ambiguous task tool updates until child sessions bind to spawned cards", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-ambiguous-deferred"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-ambiguous-deferred",
        partId: "subtask-a",
        description: "Starting A",
      }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-ambiguous-deferred",
        partId: "subtask-b",
        description: "Starting B",
      }),
      makeSubagentToolPartUpdatedEvent({
        messageId: "assistant-subagent-ambiguous-deferred",
        partId: "tool-b",
        callId: "call-b",
        tool: "task",
        status: "completed",
        childSessionId: "child-b",
        metadataOnly: true,
      }),
      makeChildSessionCreatedEvent({
        childSessionId: "child-b",
        createdAtMs: Date.parse("2026-02-22T12:00:12.000Z"),
      }),
      makeChildSessionCreatedEvent({
        childSessionId: "child-a",
        createdAtMs: Date.parse("2026-02-22T12:00:10.000Z"),
      }),
    ]);

    const subagentParts = readSubagentParts(emitted);
    expect(subagentParts).toHaveLength(4);
    expect(subagentParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-subagent-ambiguous-deferred:subtask-a",
      "part:assistant-subagent-ambiguous-deferred:subtask-b",
      "part:assistant-subagent-ambiguous-deferred:subtask-a",
      "part:assistant-subagent-ambiguous-deferred:subtask-b",
    ]);
    expect(subagentParts.map((part) => part.status)).toEqual([
      "running",
      "running",
      "running",
      "completed",
    ]);
    expect(subagentParts.map((part) => part.externalSessionId)).toEqual([
      undefined,
      undefined,
      "child-a",
      "child-b",
    ]);
  });
});
