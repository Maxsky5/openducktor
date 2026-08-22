import type { JsonValue } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import type {
  Event,
  EventSessionUpdated,
  SyncEventMessageRemoved,
} from "@opencode-ai/sdk/v2/client";
import type { AgentEvent, AgentModelSelection, AgentUserMessagePart } from "@openducktor/core";
import {
  isRelevantSubscriberEvent,
  processOpencodeEvent,
  subscribeGlobalEvents,
} from "./event-stream";
import {
  type EventStreamRuntime,
  flushPendingSubagentInputEventsForSession,
  readEventParentExternalSessionId,
  readEventSessionId,
  readSessionLifecycleEvent,
  setMessagePart,
} from "./event-stream/shared";
import { normalizeOpencodeGlobalEventPayload } from "./opencode-agent-session-projection";
import {
  childSessionCreatedEvent,
  childSessionCreatedEventWithParentAlias,
  childSessionInfo,
  malformedControlEvent,
  makeClientWithEvents,
  makeSessionInput,
  makeSessionRecord,
  permissionAskedEvent,
  permissionRepliedEvent,
  permissionV2AskedEvent,
  permissionV2RepliedEvent,
  questionAskedEvent,
  questionRejectedEvent,
  questionRepliedEvent,
  questionV2AskedEvent,
  questionV2RejectedEvent,
  questionV2RepliedEvent,
  runEventStream,
  runEventStreamWithSession,
  runtimeSourceSyncChildSessionCreatedEvent,
  type TestGlobalEventPayload,
  sessionStatusEvent,
} from "./event-stream.test-support";
import {
  buildQueuedRequestAttachmentIdentitySignature,
  buildQueuedRequestSignature,
} from "./user-message-signatures";
import { createInvalidFixture } from "./test-fixture";

const IMAGE_ATTACHMENT_DISPLAY_PART = {
  kind: "attachment" as const,
  attachment: {
    id: "attachment-image-1",
    path: "/tmp/local-screenshot.png",
    name: "Screenshot-2026-03-17-at-12.04.45.png",
    kind: "image" as const,
    mime: "image/png",
  },
};

const PDF_ATTACHMENT_DISPLAY_PART = {
  kind: "attachment" as const,
  attachment: {
    id: "attachment-pdf-1",
    path: "/tmp/local-brief.pdf",
    name: "brief.pdf",
    kind: "pdf" as const,
    mime: "application/pdf",
  },
};

test("global event observation becomes ready only after the lazy SSE stream connects", async () => {
  let connect: (() => void) | undefined;
  const connected = new Promise<void>((resolve) => {
    connect = resolve;
  });
  const client = createInvalidFixture<Parameters<typeof subscribeGlobalEvents>[0]["client"]>({
    global: {
      event: async () => ({
        stream: (async function* () {
          await connected;
          yield {
            directory: "/repo",
            payload: createInvalidFixture<Event>({
              type: "server.connected",
              properties: {},
            }),
          };
        })(),
      }),
    },
  });
  const order: string[] = [];
  const observation = subscribeGlobalEvents({
    client,
    controller: new AbortController(),
    onReady: () => {
      order.push("ready");
    },
    onEvent: (event) => {
      order.push(event.type);
    },
  });

  await Promise.resolve();
  await Promise.resolve();
  expect(order).toEqual([]);

  connect?.();
  await observation;
  expect(order).toEqual(["server.connected", "ready"]);
});

test("global event observation drops the raw envelope after normalizing sync events", async () => {
  const client = makeClientWithEvents([
    runtimeSourceSyncChildSessionCreatedEvent("external-child-session"),
  ]);
  const events: Event[] = [];

  await subscribeGlobalEvents({
    client,
    controller: new AbortController(),
    onEvent: (event) => {
      events.push(event);
    },
  });

  expect(events).toHaveLength(1);
  expect(events[0]).not.toHaveProperty("syncEvent");
  expect(events[0]).toEqual({
    id: "sync-event-runtime-source-external-child-session",
    type: "session.created",
    properties: {
      sessionID: "external-child-session",
      info: childSessionInfo("external-child-session", "external-session-1"),
      directory: "/repo",
    },
  });
});

test("classifies OpenCode server heartbeats at the global transport boundary", () => {
  const heartbeat = {
    id: "event-heartbeat-1",
    type: "server.heartbeat",
    properties: {},
  } as const;

  expect(normalizeOpencodeGlobalEventPayload(heartbeat)).toEqual({ kind: "heartbeat" });
});

test("keeps session observation alive across OpenCode server heartbeats", async () => {
  const heartbeat = createInvalidFixture<TestGlobalEventPayload>({
    id: "event-heartbeat-1",
    type: "server.heartbeat",
    properties: {},
  });
  const emitted = await runEventStream([heartbeat, sessionStatusEvent({ type: "busy" })]);

  expect(emitted).toEqual([
    expect.objectContaining({
      type: "session_status",
      status: { type: "busy", message: null },
    }),
  ]);
});

test("projects direct and sync message removal events as Transcript retractions", async () => {
  const directEvent = {
    id: "event-message-removed",
    type: "message.removed",
    properties: {
      sessionID: "external-session-1",
      messageID: "assistant-removed",
    },
  } as const;
  const syncEvent = {
    type: "sync",
    id: "sync-message-removed",
    syncEvent: {
      type: "message.removed.1",
      id: "sync-event-message-removed",
      seq: 1,
      aggregateID: "external-session-1",
      data: {
        sessionID: "external-session-1",
        messageID: "assistant-removed",
      },
    },
  } satisfies SyncEventMessageRemoved;

  for (const event of [directEvent, syncEvent]) {
    const emitted = await runEventStream([event]);
    expect(emitted).toEqual([
      {
        type: "transcript_retracted",
        externalSessionId: "external-session-1",
        timestamp: "2026-02-22T12:00:00.000Z",
        messageIds: ["assistant-removed"],
      },
    ]);
  }
});

test("does not emit removed pending assistant output when the session becomes idle", async () => {
  const emitted = await runEventStream([
    createInvalidFixture<Event>({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-removed-before-idle",
          role: "assistant",
          sessionID: "external-session-1",
          finish: "stop",
        },
        parts: [
          {
            id: "assistant-removed-before-idle-text",
            sessionID: "external-session-1",
            messageID: "assistant-removed-before-idle",
            type: "text",
            text: "This output was removed",
            time: { start: 1, end: 2 },
          },
        ],
      },
    }),
    {
      id: "event-message-removed-before-idle",
      type: "message.removed",
      properties: {
        sessionID: "external-session-1",
        messageID: "assistant-removed-before-idle",
      },
    },
    makeSessionIdleEvent(),
  ]);

  expect(emitted.some((event) => event.type === "assistant_message")).toBe(false);
  expect(emitted.filter((event) => event.type === "transcript_retracted")).toHaveLength(1);
});

test("projects current OpenCode pending-input event families", async () => {
  const emitted = await runEventStream([
    {
      id: "permission-v2-asked",
      type: "permission.v2.asked",
      properties: {
        id: "permission-v2-1",
        sessionID: "external-session-1",
        action: "write",
        resources: ["src/**"],
      },
    },
    {
      id: "permission-v2-replied",
      type: "permission.v2.replied",
      properties: {
        sessionID: "external-session-1",
        requestID: "permission-v2-1",
        reply: "once",
      },
    },
    {
      id: "question-v2-asked",
      type: "question.v2.asked",
      properties: {
        id: "question-v2-1",
        sessionID: "external-session-1",
        questions: [
          {
            header: "Confirm",
            question: "Continue?",
            options: [{ label: "Yes", description: "Continue" }],
          },
        ],
      },
    },
    {
      id: "question-v2-rejected",
      type: "question.v2.rejected",
      properties: {
        sessionID: "external-session-1",
        requestID: "question-v2-1",
      },
    },
  ]);

  expect(emitted.map((event) => event.type)).toEqual([
    "approval_required",
    "approval_resolved",
    "question_required",
    "question_resolved",
  ]);
});

const buildQueuedSignature = (message: string, model?: AgentModelSelection | null): string => {
  const parts: AgentUserMessagePart[] = [{ kind: "text", text: message }];
  return buildQueuedRequestSignature(parts, model ?? undefined);
};

test("readEventParentExternalSessionId accepts OpenCode parent id spellings", () => {
  for (const key of ["parentID", "parentId", "parent_id"] as const) {
    expect(readEventParentExternalSessionId({ [key]: "external-parent-session" })).toBe(
      "external-parent-session",
    );
    expect(readEventParentExternalSessionId({ info: { [key]: "external-parent-session" } })).toBe(
      "external-parent-session",
    );
  }

  expect(readEventParentExternalSessionId({ parentID: "" })).toBeUndefined();
  expect(readEventParentExternalSessionId({ parentID: "   " })).toBeUndefined();
  expect(readEventParentExternalSessionId({ parentID: 123 })).toBeUndefined();
  expect(readEventParentExternalSessionId(undefined)).toBeUndefined();
});

test("readEventParentExternalSessionId prefers parent ids from event info", () => {
  expect(
    readEventParentExternalSessionId({
      parentID: "event-parent-session",
      info: { parentID: "info-parent-session" },
    }),
  ).toBe("info-parent-session");
});

test("readEventSessionId accepts info.id only for session lifecycle events", () => {
  expect(
    readEventSessionId(
      createInvalidFixture<Event>({
        type: "session.created",
        properties: {
          info: { id: "external-child-session" },
        },
      }),
    ),
  ).toBe("external-child-session");
  expect(
    readEventSessionId(
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: { id: "message-1" },
        },
      }),
    ),
  ).toBeUndefined();
});

test("readSessionLifecycleEvent reads exact lifecycle lineage", () => {
  const event = childSessionCreatedEvent("external-child-session");

  expect(readSessionLifecycleEvent(event)).toEqual({
    type: "session.created",
    properties: event.properties,
    info: event.properties.info,
    externalSessionId: "external-child-session",
    parentExternalSessionId: "external-session-1",
  });
});

test("readSessionLifecycleEvent ignores parent aliases and non-lifecycle events", () => {
  const event = childSessionCreatedEvent("external-child-session");
  const aliasEvent = childSessionCreatedEventWithParentAlias("external-child-session", "parentId");

  expect(readSessionLifecycleEvent(aliasEvent)?.parentExternalSessionId).toBeUndefined();
  expect(
    readSessionLifecycleEvent(
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: event.properties,
      }),
    ),
  ).toBeUndefined();
});

test("runEventStreamWithSession uses the configured session input", async () => {
  const { emitted } = await runEventStreamWithSession(
    [
      sessionStatusEvent({ type: "busy" }, "external-session-1", {
        directory: "/workspace",
      }),
    ],
    (session) => {
      session.input = {
        ...session.input,
        workingDirectory: "/workspace",
      };
    },
  );

  expect(emitted).toContainEqual({
    type: "session_status",
    externalSessionId: "external-session-1",
    timestamp: "2026-02-22T12:00:00.000Z",
    status: { type: "busy", message: null },
  });
});

test("runEventStreamWithSession emits permission v2 approval events", async () => {
  const { emitted } = await runEventStreamWithSession([
    permissionV2AskedEvent({
      requestId: "perm-v2-1",
      action: "edit",
      resources: ["/repo/src/app.ts"],
      save: ["/repo/src/**"],
      metadata: {
        filepath: "/repo/src/app.ts",
        diff: "--- /repo/src/app.ts\n+++ /repo/src/app.ts\n@@\n-old\n+new",
      },
    }),
  ]);

  expect(emitted).toContainEqual(
    expect.objectContaining({
      type: "approval_required",
      externalSessionId: "external-session-1",
      requestId: "perm-v2-1",
      action: { name: "edit" },
      affectedPaths: ["/repo/src/app.ts"],
      metadata: expect.objectContaining({
        opencode: expect.objectContaining({
          save: ["/repo/src/**"],
          metadata: expect.objectContaining({
            filepath: "/repo/src/app.ts",
            diff: "--- /repo/src/app.ts\n+++ /repo/src/app.ts\n@@\n-old\n+new",
          }),
        }),
      }),
    }),
  );
});

test("flushPendingSubagentInputEventsForSession preserves original timestamps", () => {
  const emitted: AgentEvent[] = [];
  const session = makeSessionRecord(makeClientWithEvents([]));
  session.subagentCorrelationKeyByExternalSessionId.set(
    "external-child-session",
    "part:assistant-1:subtask-1",
  );
  session.pendingSubagentInputEventsByExternalSessionId.set("external-child-session", [
    {
      type: "approval_required",
      externalSessionId: "external-session-1",
      timestamp: "2026-02-22T12:00:00.000Z",
      requestId: "perm-child-1",
      requestType: "permission_grant",
      title: "Approve permission: write",
      summary: "Approval request for write.",
      affectedPaths: ["src/**"],
      action: { name: "write" },
      mutation: "mutating",
      supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
      childExternalSessionId: "external-child-session",
    },
    {
      type: "question_required",
      externalSessionId: "external-session-1",
      timestamp: "2026-02-22T12:05:00.000Z",
      requestId: "question-child-1",
      questions: [
        {
          header: "Scope",
          question: "Pick target",
          options: [{ label: "A", description: "Option A" }],
        },
      ],
      childExternalSessionId: "external-child-session",
    },
  ]);
  const runtime: EventStreamRuntime = {
    externalSessionId: "external-session-1",
    input: makeSessionInput(),
    session,
    now: () => "2026-02-22T12:30:00.000Z",
    emit: (_externalSessionId: string, event: AgentEvent) => {
      emitted.push(event);
    },
  };

  flushPendingSubagentInputEventsForSession(runtime, "external-child-session");

  expect(emitted).toEqual([
    {
      type: "approval_required",
      externalSessionId: "external-session-1",
      timestamp: "2026-02-22T12:00:00.000Z",
      requestId: "perm-child-1",
      requestType: "permission_grant",
      title: "Approve permission: write",
      summary: "Approval request for write.",
      affectedPaths: ["src/**"],
      action: { name: "write" },
      mutation: "mutating",
      supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    },
    {
      type: "question_required",
      externalSessionId: "external-session-1",
      timestamp: "2026-02-22T12:05:00.000Z",
      requestId: "question-child-1",
      questions: [
        {
          header: "Scope",
          question: "Pick target",
          options: [{ label: "A", description: "Option A" }],
        },
      ],
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    },
  ]);
  expect(
    runtime.session.pendingSubagentInputEventsByExternalSessionId.get("external-child-session"),
  ).toBeUndefined();
});

const assistantRoleEvent = (messageId: string): Event =>
  createInvalidFixture<Event>({
    type: "message.updated",
    properties: {
      info: {
        id: messageId,
        role: "assistant",
        sessionID: "external-session-1",
      },
    },
  });

const makeSessionIdleEvent = (): Event =>
  createInvalidFixture<Event>({
    type: "session.idle",
    properties: {
      sessionID: "external-session-1",
    },
  });

const makeSessionStatusIdleEvent = (): Event => sessionStatusEvent({ type: "idle" });

const makeAssistantTextPart = (input: {
  messageId: string;
  text: string;
  partId?: string;
  start?: number;
  end?: number;
}) =>
  ({
    id: input.partId ?? `${input.messageId}-text-1`,
    sessionID: "external-session-1",
    messageID: input.messageId,
    type: "text",
    text: input.text,
    time: {
      start: input.start ?? 1,
      end: input.end ?? 1,
    },
  }) satisfies Record<string, JsonValue>;

const makeAssistantMessageUpdatedEvent = (input: {
  messageId: string;
  text?: string;
  partId?: string;
  finish?: string;
  completedAt?: number;
  parts?: unknown[];
  info?: Record<string, JsonValue>;
}): Event => {
  const parts =
    input.parts ??
    (input.text !== undefined
      ? [
          makeAssistantTextPart({
            messageId: input.messageId,
            partId: input.partId,
            text: input.text,
          }),
        ]
      : undefined);

  return createInvalidFixture<Event>({
    type: "message.updated",
    properties: {
      info: {
        id: input.messageId,
        role: "assistant",
        sessionID: "external-session-1",
        ...(input.finish ? { finish: input.finish } : undefined),
        ...(input.completedAt !== undefined
          ? { time: { completed: input.completedAt } }
          : undefined),
        ...input.info,
      },
      ...(parts ? { parts } : undefined),
    },
  });
};

const makeMessagePartUpdatedEvent = (input: {
  messageId: string;
  partId: string;
  text: string;
  end?: number;
}): Event =>
  createInvalidFixture<Event>({
    type: "message.part.updated",
    properties: {
      part: makeAssistantTextPart({
        messageId: input.messageId,
        partId: input.partId,
        text: input.text,
        end: input.end,
      }),
    },
  });

const makeAssistantStepFinishPartUpdatedEvent = (input: {
  messageId: string;
  partId: string;
  reason?: string;
}): Event =>
  createInvalidFixture<Event>({
    type: "message.part.updated",
    properties: {
      part: {
        id: input.partId,
        sessionID: "external-session-1",
        messageID: input.messageId,
        type: "step-finish",
        reason: input.reason ?? "stop",
        cost: 0,
        tokens: {},
      },
    },
  });

const makeAssistantSubtaskPartUpdatedEvent = (input: {
  messageId: string;
  partId: string;
  agent: string;
  prompt: string;
  description: string;
}): Event =>
  createInvalidFixture<Event>({
    type: "message.part.updated",
    properties: {
      part: {
        id: input.partId,
        sessionID: "external-session-1",
        messageID: input.messageId,
        type: "subtask",
        agent: input.agent,
        prompt: input.prompt,
        description: input.description,
      },
    },
  });

const makeMessagePartDeltaEvent = (input: {
  messageId: string;
  partId: string;
  field: string;
  delta: string;
}): Event =>
  createInvalidFixture<Event>({
    type: "message.part.delta",
    properties: {
      sessionID: "external-session-1",
      partID: input.partId,
      messageID: input.messageId,
      field: input.field,
      delta: input.delta,
    },
  });

describe("event-stream", () => {
  test("does not project OpenCode compaction events as shared transcript notices", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "compact-part-1",
            sessionID: "external-session-1",
            messageID: "compact-message-1",
            type: "compaction",
            auto: false,
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "session.compacted",
        properties: { sessionID: "external-session-1" },
      }),
      createInvalidFixture<Event>({
        type: "session.compacted",
        properties: { sessionID: "external-session-1" },
      }),
    ]);

    expect(
      emitted.filter(
        (event) =>
          event.type === "session_compaction_started" || event.type === "session_compacted",
      ),
    ).toEqual([]);
  });

  test("projects OpenCode compaction summary messages as assistant output", async () => {
    const emitted = await runEventStream([
      makeAssistantMessageUpdatedEvent({
        messageId: "compact-summary-message",
        text: "Compacted session context",
        finish: "stop",
        completedAt: 2,
        info: { summary: true },
      }),
      makeSessionStatusIdleEvent(),
    ]);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      messageId: "compact-summary-message",
      message: "Compacted session context",
    });
  });

  test("keeps the OpenCode compaction marker hidden without suppressing its assistant summary", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "compact-marker",
            sessionID: "external-session-1",
            messageID: "compact-marker-message",
            type: "compaction",
            auto: false,
          },
        },
      }),
      makeAssistantMessageUpdatedEvent({
        messageId: "compact-summary-message",
        text: "Compacted session context",
        finish: "stop",
        completedAt: 3,
        info: { summary: true },
      }),
      makeSessionStatusIdleEvent(),
    ]);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      messageId: "compact-summary-message",
      message: "Compacted session context",
    });
  });

  test("emits user_message when opencode acknowledges a user turn", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-1",
            role: "user",
            sessionID: "external-session-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            text: "Generate the PR",
            time: {
              created: Date.parse("2026-02-22T12:00:03.000Z"),
            },
          },
        },
      }),
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    if (userMessages[0]?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }
    expect(userMessages[0].messageId).toBe("user-message-1");
    expect(userMessages[0].message).toBe("Generate the PR");
    expect(userMessages[0].timestamp).toBe("2026-02-22T12:00:03.000Z");
    expect(userMessages[0].parts).toEqual([{ kind: "text", text: "Generate the PR" }]);
    expect(userMessages[0].model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });
  });

  test("emits user_message from stored user text parts when message.updated omits visible text", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-part-1",
            sessionID: "external-session-1",
            messageID: "user-message-2",
            type: "text",
            text: "Generate the PR",
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-2",
            role: "user",
            sessionID: "external-session-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            time: {
              created: Date.parse("2026-02-22T12:00:04.000Z"),
            },
          },
        },
      }),
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    if (userMessages[0]?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }
    expect(userMessages[0]).toMatchObject({
      messageId: "user-message-2",
      message: "Generate the PR",
      timestamp: "2026-02-22T12:00:04.000Z",
    });
    expect(userMessages[0].parts).toEqual([{ kind: "text", text: "Generate the PR" }]);
  });

  test("emits user_message when user text parts arrive after message.updated", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-3",
            role: "user",
            sessionID: "external-session-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            time: {
              created: Date.parse("2026-02-22T12:00:05.000Z"),
            },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-part-2",
            sessionID: "external-session-1",
            messageID: "user-message-3",
            type: "text",
            text: "Ship it",
          },
        },
      }),
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    if (userMessages[0]?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }
    expect(userMessages[0]).toMatchObject({
      messageId: "user-message-3",
      message: "Ship it",
      timestamp: "2026-02-22T12:00:05.000Z",
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "Hephaestus",
        variant: "high",
      },
    });
    expect(userMessages[0].parts).toEqual([{ kind: "text", text: "Ship it" }]);
  });

  test("re-emits user_message when later parts update the visible text", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-4",
            role: "user",
            sessionID: "external-session-1",
            text: "Old text",
            time: {
              created: Date.parse("2026-02-22T12:00:06.000Z"),
            },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-part-4",
            sessionID: "external-session-1",
            messageID: "user-message-4",
            type: "text",
            text: "New text",
          },
        },
      }),
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "user-message-4",
      message: "Old text",
      state: "read",
    });
    expect(userMessages[1]).toMatchObject({
      type: "user_message",
      messageId: "user-message-4",
      message: "New text",
      state: "read",
    });
    expect(userMessages[1]?.parts).toEqual([{ kind: "text", text: "New text" }]);
  });

  test("suppresses redundant slash-command instruction echo parts in live user messages", async () => {
    const slashEnvelope = `<auto-slash-command>\n# /test-command Command\n\n**Description**: A command for testing slash commands\n\n**User Arguments**: pouet\n\n**Scope**: opencode\n\n---\n\n## Command Instructions\n\nI just want to test the slash commands mechanism.\nReturn the arguments of this command: pouet\n\n\n---\n\n## User Request\n\npouet\n</auto-slash-command>`;

    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-slash-1",
            role: "user",
            sessionID: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:06.500Z"),
            },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-part-slash-envelope",
            sessionID: "external-session-1",
            messageID: "user-message-slash-1",
            type: "text",
            text: slashEnvelope,
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-part-slash-echo",
            sessionID: "external-session-1",
            messageID: "user-message-slash-1",
            type: "text",
            text: "I just want to test the slash commands mechanism.\nReturn the arguments of this command: pouet",
          },
        },
      }),
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    const latestUserMessage = userMessages[userMessages.length - 1];
    if (latestUserMessage?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }

    expect(latestUserMessage.message).toBe(slashEnvelope);
    expect(latestUserMessage.parts).toEqual([{ kind: "text", text: slashEnvelope }]);
  });

  test("preserves visible user text when later file parts arrive without visible text parts", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-5",
            role: "user",
            sessionID: "external-session-1",
            text: "check @src/main.ts please",
            time: {
              created: Date.parse("2026-02-22T12:00:07.000Z"),
            },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-file-5",
            sessionID: "external-session-1",
            messageID: "user-message-5",
            type: "file",
            mime: "text/plain",
            filename: "main.ts",
            url: "file:///repo/src/main.ts",
            source: {
              type: "file",
              path: "src/main.ts",
              text: {
                value: "@src/main.ts",
                start: 6,
                end: 18,
              },
            },
          },
        },
      }),
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "user-message-5",
      message: "check @src/main.ts please",
    });
    expect(userMessages[1]).toMatchObject({
      type: "user_message",
      messageId: "user-message-5",
      message: "check @src/main.ts please",
      parts: [
        {
          kind: "text",
          text: "check @src/main.ts please",
        },
        {
          kind: "file_reference",
          file: {
            id: "user-file-5",
            path: "src/main.ts",
            name: "main.ts",
            kind: "code",
          },
          sourceText: {
            value: "@src/main.ts",
            start: 6,
            end: 18,
          },
        },
      ],
    });
  });

  test("keeps queued follow-ups queued until the pending assistant clears", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "message-100",
            role: "assistant",
            sessionID: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:01.000Z"),
            },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "message-200",
            role: "user",
            sessionID: "external-session-1",
            text: "Ship it",
            time: {
              created: Date.parse("2026-02-22T12:00:02.000Z"),
            },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "session.idle",
        properties: {
          sessionID: "external-session-1",
        },
      }),
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "message-200",
      message: "Ship it",
      state: "queued",
    });
    expect(userMessages[1]).toMatchObject({
      type: "user_message",
      messageId: "message-200",
      message: "Ship it",
      state: "read",
    });
  });

  test("does not leave a late queued-send acknowledgement stuck queued after idle", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "message.updated",
          properties: {
            info: {
              id: "message-200",
              role: "user",
              sessionID: "external-session-1",
              text: "Ship it",
              time: {
                created: Date.parse("2026-02-22T12:00:02.000Z"),
              },
            },
          },
        }),
      ],
      (nextSessionRecord) => {
        nextSessionRecord.pendingQueuedUserMessages.push({
          messageId: "message-200",
          signature: buildQueuedSignature("Ship it"),
        });
        nextSessionRecord.activeAssistantMessageId = null;
      },
    );

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "message-200",
      message: "Ship it",
      state: "read",
    });
    expect(sessionRecord.pendingQueuedUserMessages).toHaveLength(0);
  });

  test("removes a queued send when OpenCode retracts it before the message echo", async () => {
    const { sessionRecord } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "message.removed",
          properties: {
            sessionID: "external-session-1",
            messageID: "message-pending",
          },
        }),
      ],
      (session) => {
        session.pendingQueuedUserMessages.push({
          messageId: "message-pending",
          signature: buildQueuedSignature("Ship it"),
        });
      },
    );

    expect(sessionRecord.pendingQueuedUserMessages).toEqual([]);
  });

  test("ignores unrelated status fields when deriving explicit user message state", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "msg-100",
            role: "assistant",
            sessionID: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:01.000Z"),
            },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "msg-200",
            role: "user",
            sessionID: "external-session-1",
            text: "Ship it",
            status: "read",
            time: {
              created: Date.parse("2026-02-22T12:00:02.000Z"),
            },
          },
        },
      }),
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "msg-200",
      state: "queued",
    });
  });

  test("matches queued sends by exact model selection when content repeats", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "message.updated",
          properties: {
            info: {
              id: "msg-200",
              role: "user",
              sessionID: "external-session-1",
              providerID: "openai",
              modelID: "gpt-5",
              agent: "Hephaestus",
              variant: "high",
              text: "Ship it",
              time: {
                created: Date.parse("2026-02-22T12:00:02.000Z"),
              },
            },
          },
        }),
      ],
      (nextSessionRecord) => {
        nextSessionRecord.activeAssistantMessageId = "msg-100";
        nextSessionRecord.pendingQueuedUserMessages.push(
          { messageId: "msg-unselected", signature: buildQueuedSignature("Ship it") },
          {
            messageId: "msg-200",
            signature: buildQueuedSignature("Ship it", {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              profileId: "Hephaestus",
              variant: "high",
            }),
          },
        );
      },
    );

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "msg-200",
      state: "queued",
    });
    expect(sessionRecord.pendingQueuedUserMessages).toEqual([
      { messageId: "msg-unselected", signature: buildQueuedSignature("Ship it") },
    ]);
  });

  test("preserves queued local attachment preview paths when the runtime echoes a non-file attachment url", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "message.updated",
          properties: {
            info: {
              id: "msg-attachment-1",
              role: "user",
              sessionID: "external-session-1",
              text: "Describe what is in this screenshot",
              time: {
                created: Date.parse("2026-02-22T12:00:02.000Z"),
              },
            },
            parts: [
              {
                id: "part-text-1",
                sessionID: "external-session-1",
                messageID: "msg-attachment-1",
                type: "text",
                text: "Describe what is in this screenshot",
              },
              {
                id: "part-file-1",
                sessionID: "external-session-1",
                messageID: "msg-attachment-1",
                type: "file",
                mime: "image/png",
                filename: "Screenshot-2026-03-17-at-12.04.45.png",
                url: "https://files.example.invalid/uploaded-image",
              },
            ],
          },
        }),
      ],
      (nextSessionRecord) => {
        // SAFETY: This test controls the fixture and supplies `AgentUserMessagePart[]` used by this case.
        nextSessionRecord.pendingQueuedUserMessages.push({
          messageId: "msg-attachment-1",
          signature: buildQueuedRequestSignature(
            [
              { kind: "text", text: "Describe what is in this screenshot" },
              IMAGE_ATTACHMENT_DISPLAY_PART,
            ] as AgentUserMessagePart[],
            undefined,
          ),
          attachmentIdentitySignature: buildQueuedRequestAttachmentIdentitySignature(
            [
              { kind: "text", text: "Describe what is in this screenshot" },
              IMAGE_ATTACHMENT_DISPLAY_PART,
            ] as AgentUserMessagePart[],
            undefined,
          ),
          attachmentParts: [IMAGE_ATTACHMENT_DISPLAY_PART],
        });
      },
    );

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    const userMessage = userMessages[0];
    if (userMessage?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }
    expect(userMessage.parts).toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/local-screenshot.png",
          name: "Screenshot-2026-03-17-at-12.04.45.png",
          kind: "image",
          mime: "image/png",
        }),
      }),
    );

    const metadata = sessionRecord.messageMetadataById.get("msg-attachment-1");
    expect(metadata?.displayParts).toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/local-screenshot.png",
          name: "Screenshot-2026-03-17-at-12.04.45.png",
          kind: "image",
          mime: "image/png",
        }),
      }),
    );
  });

  test("matches queued attachment sends when the runtime fills user parts through message.part.updated", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "message.updated",
          properties: {
            info: {
              id: "msg-attachment-partial-1",
              role: "user",
              sessionID: "external-session-1",
              text: "Describe what is in this screenshot",
              time: {
                created: Date.parse("2026-02-22T12:00:02.000Z"),
              },
            },
          },
        }),
        createInvalidFixture<Event>({
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-file-partial-1",
              sessionID: "external-session-1",
              messageID: "msg-attachment-partial-1",
              type: "file",
              mime: "image/png",
              filename: "Screenshot-2026-03-17-at-12.04.45.png",
              url: "https://files.example.invalid/uploaded-image",
            },
          },
        }),
      ],
      (nextSessionRecord) => {
        nextSessionRecord.messageRoleById.set("msg-attachment-partial-1", "user");
        // SAFETY: This test controls the fixture and supplies `AgentUserMessagePart[]` used by this case.
        nextSessionRecord.pendingQueuedUserMessages.push({
          messageId: "msg-attachment-partial-1",
          signature: buildQueuedRequestSignature(
            [
              { kind: "text", text: "Describe what is in this screenshot" },
              IMAGE_ATTACHMENT_DISPLAY_PART,
            ] as AgentUserMessagePart[],
            undefined,
          ),
          attachmentIdentitySignature: buildQueuedRequestAttachmentIdentitySignature(
            [
              { kind: "text", text: "Describe what is in this screenshot" },
              IMAGE_ATTACHMENT_DISPLAY_PART,
            ] as AgentUserMessagePart[],
            undefined,
          ),
          attachmentParts: [IMAGE_ATTACHMENT_DISPLAY_PART],
        });
      },
    );

    expect(sessionRecord.pendingQueuedUserMessages).toHaveLength(0);
    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(2);
    const latestUserMessage = userMessages[userMessages.length - 1];
    if (latestUserMessage?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }
    expect(latestUserMessage.parts).toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/local-screenshot.png",
          name: "Screenshot-2026-03-17-at-12.04.45.png",
          kind: "image",
          mime: "image/png",
        }),
      }),
    );
  });

  test("keeps pdf attachment echoes out of inline file-reference rendering", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "message.updated",
          properties: {
            info: {
              id: "msg-pdf-1",
              role: "user",
              text: "Summarize this PDF",
              sessionID: "external-session-1",
              time: {
                created: Date.parse("2026-02-22T12:00:02.000Z"),
              },
              parts: [
                {
                  id: "part-text-1",
                  sessionID: "external-session-1",
                  messageID: "msg-pdf-1",
                  type: "text",
                  text: "Summarize this PDF",
                },
                {
                  id: "part-file-1",
                  sessionID: "external-session-1",
                  messageID: "msg-pdf-1",
                  type: "file",
                  mime: "application/pdf",
                  filename: "brief.pdf",
                  url: "https://files.example.invalid/brief.pdf",
                  source: {
                    type: "file",
                    path: "brief.pdf",
                    text: {
                      value: "brief.pdf",
                      start: 0,
                      end: 9,
                    },
                  },
                },
              ],
            },
          },
        }),
      ],
      (nextSessionRecord) => {
        // SAFETY: This test controls the fixture and supplies `AgentUserMessagePart[]` used by this case.
        nextSessionRecord.pendingQueuedUserMessages.push({
          messageId: "msg-pdf-1",
          signature: buildQueuedRequestSignature(
            [
              { kind: "text", text: "Summarize this PDF" },
              PDF_ATTACHMENT_DISPLAY_PART,
            ] as AgentUserMessagePart[],
            undefined,
          ),
          attachmentIdentitySignature: buildQueuedRequestAttachmentIdentitySignature(
            [
              { kind: "text", text: "Summarize this PDF" },
              PDF_ATTACHMENT_DISPLAY_PART,
            ] as AgentUserMessagePart[],
            undefined,
          ),
          attachmentParts: [PDF_ATTACHMENT_DISPLAY_PART],
        });
      },
    );

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    const userMessage = userMessages[0];
    if (userMessage?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }

    expect(userMessage.parts.filter((part) => part.kind === "attachment")).toHaveLength(1);
    expect(userMessage.parts.filter((part) => part.kind === "file_reference")).toHaveLength(0);
    expect(userMessage.parts).toContainEqual(
      expect.objectContaining({
        kind: "attachment",
        attachment: expect.objectContaining({
          path: "/tmp/local-brief.pdf",
          name: "brief.pdf",
          kind: "pdf",
          mime: "application/pdf",
        }),
      }),
    );
  });

  test("reconciles queued follow-ups when a newer assistant becomes pending", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "msg-100",
            role: "assistant",
            sessionID: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:01.000Z"),
            },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "msg-200",
            role: "user",
            sessionID: "external-session-1",
            text: "Ship it",
            time: {
              created: Date.parse("2026-02-22T12:00:02.000Z"),
            },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "msg-300",
            role: "assistant",
            parentID: "msg-200",
            sessionID: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:03.000Z"),
            },
          },
        },
      }),
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "msg-200",
      state: "queued",
    });
    expect(userMessages[1]).toMatchObject({
      type: "user_message",
      messageId: "msg-200",
      state: "read",
    });
  });

  test("deduplicates assistant_message across repeated message.updated events", async () => {
    const assistantEvent = makeAssistantMessageUpdatedEvent({
      messageId: "assistant-message-1",
      finish: "stop",
      completedAt: 1,
      info: {
        providerID: "openai",
        modelID: "gpt-5",
        agent: "Hephaestus",
        variant: "high",
        tokens: {
          input: 100,
          output: 20,
        },
      },
      parts: [
        {
          id: "reasoning-1",
          sessionID: "external-session-1",
          messageID: "assistant-message-1",
          type: "reasoning",
          text: "Plan",
          time: { start: 1, end: 2 },
        },
        makeAssistantTextPart({
          messageId: "assistant-message-1",
          partId: "text-1",
          text: "Done",
          end: 2,
        }),
      ],
    });

    const { emitted } = await runEventStreamWithSession([
      assistantEvent,
      assistantEvent,
      makeSessionStatusIdleEvent(),
    ]);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0].messageId).toBe("assistant-message-1");
    expect(assistantMessages[0].totalTokens).toBe(120);
    expect(assistantMessages[0].model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });
    expect(emitted.some((event) => event.type === "assistant_part")).toBe(true);
  });

  test("finalizes pending output without scanning transcript parts", async () => {
    let partScans = 0;
    const { emitted } = await runEventStreamWithSession(
      [makeSessionStatusIdleEvent(), makeSessionIdleEvent()],
      (session) => {
        for (let index = 0; index < 100; index += 1) {
          const messageId = `assistant-finalized-${index}`;
          session.completedAssistantMessageIds.add(messageId);
          session.emittedAssistantMessageIds.add(messageId);
          session.messageRoleById.set(messageId, "assistant");
        }
        const pendingMessageId = "assistant-pending-final";
        const pendingPart = makeAssistantTextPart({
          messageId: pendingMessageId,
          partId: "text-pending-final",
          text: "Pending final output",
          end: 1,
        });
        session.completedAssistantMessageIds.add(pendingMessageId);
        session.pendingCompletedAssistantMessageIds.add(pendingMessageId);
        session.messageRoleById.set(pendingMessageId, "assistant");
        session.messageMetadataById.set(pendingMessageId, {
          timestamp: "2026-02-22T12:00:00.000Z",
          hasStopSignal: true,
        });
        setMessagePart(session, pendingPart);
        const values = session.partsById.values.bind(session.partsById);
        Object.defineProperty(session.partsById, "values", {
          value: () => {
            partScans += 1;
            return values();
          },
        });
      },
    );

    expect(partScans).toBe(0);
    expect(emitted.filter((event) => event.type === "assistant_message")).toEqual([
      expect.objectContaining({ message: "Pending final output" }),
    ]);
  });

  test("emits session_idle for stop-finished assistant turns without visible text", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-stop-only",
            role: "assistant",
            sessionID: "external-session-1",
            finish: "stop",
          },
          parts: [
            {
              id: "step-1",
              sessionID: "external-session-1",
              messageID: "assistant-message-stop-only",
              type: "step-finish",
              reason: "stop",
              cost: 0,
              tokens: {},
            },
          ],
        },
      }),
      makeSessionIdleEvent(),
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
    expect(emitted.some((event) => event.type === "assistant_message")).toBe(false);
  });

  test("emits session_idle for error-finished assistant turns with visible provider errors", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-provider-error",
        finish: "error",
        completedAt: 1,
        text: "Error from provider (Console Go): Upstream request failed",
        partId: "text-provider-error-1",
      }),
      makeSessionIdleEvent(),
    ]);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0].message).toBe(
      "Error from provider (Console Go): Upstream request failed",
    );
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(1);
    expect(sessionRecord.streamTurnStatus).toBe("idle");
  });

  test("does not emit session_idle or final assistant_message when completion lacks a stop signal", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-completed-time",
            role: "assistant",
            sessionID: "external-session-1",
            time: {
              completed: 1,
            },
          },
          parts: [
            {
              id: "text-completed-time-1",
              sessionID: "external-session-1",
              messageID: "assistant-message-completed-time",
              type: "text",
              text: "Completed without finish stop",
              time: { start: 1, end: 1 },
            },
          ],
        },
      }),
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(0);
    expect(emitted.some((event) => event.type === "assistant_message")).toBe(false);
  });

  test("deduplicates upstream session.idle after a terminal assistant update", async () => {
    const emitted = await runEventStream([
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-terminal-idle",
        finish: "stop",
        text: "Done once",
        partId: "text-terminal-idle-1",
      }),
      makeSessionIdleEvent(),
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("emits final assistant_message from known parts when terminal metadata arrives later", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-part-late-1",
            sessionID: "external-session-1",
            messageID: "assistant-message-late-final",
            type: "text",
            text: "Final answer",
            time: { start: 1, end: 1 },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-late-final",
            role: "assistant",
            sessionID: "external-session-1",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            agent: "Hephaestus",
            variant: "max",
            tokens: {
              input: 10,
              output: 5,
            },
            time: {
              created: Date.parse("2026-02-22T12:00:06.000Z"),
              completed: Date.parse("2026-02-22T12:00:08.000Z"),
            },
            finish: "stop",
          },
        },
      }),
      makeSessionIdleEvent(),
    ]);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0]).toMatchObject({
      messageId: "assistant-message-late-final",
      message: "Final answer",
      totalTokens: 15,
      model: {
        providerId: "anthropic",
        modelId: "claude-sonnet",
        profileId: "Hephaestus",
        variant: "max",
      },
    });

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("does not emit idle or final assistant_message from known parts without a stop signal", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-part-late-2",
            sessionID: "external-session-1",
            messageID: "assistant-message-late-nonfinal",
            type: "text",
            text: "Intermediate answer",
            time: { start: 1, end: 1 },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-late-nonfinal",
            role: "assistant",
            sessionID: "external-session-1",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            agent: "Hephaestus",
            variant: "max",
            tokens: {
              input: 10,
              output: 5,
            },
            time: {
              created: Date.parse("2026-02-22T12:00:06.000Z"),
              completed: Date.parse("2026-02-22T12:00:08.000Z"),
            },
          },
        },
      }),
    ]);

    expect(emitted.some((event) => event.type === "assistant_message")).toBe(false);
    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(0);
  });

  test("preserves existing idle state when session.idle arrives before a terminal assistant update", async () => {
    const emitted = await runEventStream([
      makeSessionIdleEvent(),
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-idle-first",
        finish: "stop",
        text: "Done after idle",
        partId: "text-idle-first-1",
      }),
    ]);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(0);
    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("does not emit duplicate session_idle across repeated terminal message updates", async () => {
    const terminalEvent = makeAssistantMessageUpdatedEvent({
      messageId: "assistant-message-duplicate-terminal",
      finish: "stop",
      completedAt: 1,
      text: "Done twice",
      partId: "text-duplicate-terminal-1",
    });

    const emitted = await runEventStream([terminalEvent, terminalEvent, makeSessionIdleEvent()]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("marks session idle on session.status idle so later terminal updates do not duplicate it", async () => {
    const emitted = await runEventStream([
      makeSessionStatusIdleEvent(),
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-status-idle",
        finish: "stop",
        completedAt: 1,
        text: "Done after idle status",
        partId: "text-status-idle-1",
      }),
    ]);

    const statusEvents = emitted.filter((event) => event.type === "session_status");
    expect(statusEvents).toHaveLength(1);
    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(0);
  });

  test("ignores session.status idle while waiting for runtime turn start", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [makeSessionStatusIdleEvent()],
      (session) => {
        session.isSendingUserMessage = true;
        session.isAwaitingRuntimeTurnStart = true;
      },
    );

    expect(emitted.filter((event) => event.type === "session_status")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(0);
    expect(sessionRecord.streamTurnStatus).toBe("active");
  });

  test("honors session.status idle after runtime turn start while a send is still in flight", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [makeSessionStatusIdleEvent()],
      (session) => {
        session.isSendingUserMessage = true;
        session.isAwaitingRuntimeTurnStart = false;
      },
    );

    const statusEvents = emitted.filter((event) => event.type === "session_status");
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]).toMatchObject({ status: { type: "idle" } });
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(0);
    expect(sessionRecord.streamTurnStatus).toBe("idle");
  });

  test("honors session.idle after runtime turn start while a send is still in flight", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [makeSessionIdleEvent()],
      (session) => {
        session.isSendingUserMessage = true;
        session.isAwaitingRuntimeTurnStart = false;
      },
    );

    expect(emitted.filter((event) => event.type === "session_status")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(1);
    expect(sessionRecord.streamTurnStatus).toBe("idle");
  });

  test("ignores OpenCode idle events while waiting for runtime turn start", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [makeSessionStatusIdleEvent(), makeSessionIdleEvent()],
      (session) => {
        session.isAwaitingRuntimeTurnStart = true;
      },
    );

    expect(emitted.filter((event) => event.type === "session_status")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(0);
    expect(sessionRecord.streamTurnStatus).toBe("active");
    expect(sessionRecord.isAwaitingRuntimeTurnStart).toBe(true);
  });

  test("terminal assistant events clear pending turn start even when stream status is idle", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [
        makeAssistantMessageUpdatedEvent({
          messageId: "assistant-message-pending-terminal",
          finish: "stop",
          completedAt: 1,
          text: "Done after pending turn",
          partId: "text-pending-terminal-1",
        }),
        makeSessionIdleEvent(),
      ],
      (session) => {
        session.streamTurnStatus = "idle";
        session.isAwaitingRuntimeTurnStart = true;
      },
    );

    expect(emitted.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(1);
    expect(sessionRecord.isAwaitingRuntimeTurnStart).toBe(false);
    expect(sessionRecord.streamTurnStatus).toBe("idle");
  });

  test("keeps terminal part updates live until authoritative idle", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-late-part-update",
        finish: "stop",
        completedAt: 1,
        text: "Done",
        partId: "text-late-part-update-1",
      }),
      makeMessagePartUpdatedEvent({
        messageId: "assistant-message-late-part-update",
        partId: "text-late-part-update-1",
        text: "Done later",
        end: 2,
      }),
      makeSessionStatusIdleEvent(),
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(2);
    expect(emitted.filter((event) => event.type === "assistant_message")).toEqual([
      expect.objectContaining({ message: "Done later" }),
    ]);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(0);

    const updatedPart = sessionRecord.partsById.get("text-late-part-update-1");
    if (updatedPart?.type !== "text") {
      throw new Error("Expected cached assistant text part");
    }
    expect(updatedPart.text).toBe("Done later");
  });

  test("keeps terminal part deltas live until authoritative idle", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-late-delta",
        finish: "stop",
        completedAt: 1,
        text: "Done",
        partId: "text-late-delta-1",
      }),
      makeMessagePartDeltaEvent({
        messageId: "assistant-message-late-delta",
        partId: "text-late-delta-1",
        field: "text",
        delta: " later",
      }),
      makeSessionStatusIdleEvent(),
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(2);
    expect(emitted.filter((event) => event.type === "assistant_delta")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(0);

    const updatedPart = sessionRecord.partsById.get("text-late-delta-1");
    if (updatedPart?.type !== "text") {
      throw new Error("Expected cached assistant text part");
    }
    expect(updatedPart.text).toBe("Done later");
  });

  test("emits a final assistant message when terminal metadata arrives before idle-preserved parts", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      makeSessionIdleEvent(),
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-idle-late-part",
        finish: "stop",
        completedAt: 1,
      }),
      makeMessagePartUpdatedEvent({
        messageId: "assistant-message-idle-late-part",
        partId: "text-idle-late-part-1",
        text: "Recovered final output",
      }),
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "assistant_delta")).toHaveLength(0);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0].message).toBe("Recovered final output");

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);

    const updatedPart = sessionRecord.partsById.get("text-idle-late-part-1");
    if (updatedPart?.type !== "text") {
      throw new Error("Expected cached assistant text part");
    }
    expect(updatedPart.text).toBe("Recovered final output");
  });

  test("emits a final assistant message after pending deltas are applied to idle-preserved parts", async () => {
    const emitted = await runEventStream([
      makeSessionIdleEvent(),
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-idle-late-delta",
        finish: "stop",
        completedAt: 1,
      }),
      makeMessagePartDeltaEvent({
        messageId: "assistant-message-idle-late-delta",
        partId: "text-idle-late-delta-1",
        field: "text",
        delta: "Recovered",
      }),
      makeMessagePartUpdatedEvent({
        messageId: "assistant-message-idle-late-delta",
        partId: "text-idle-late-delta-1",
        text: "",
      }),
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "assistant_delta")).toHaveLength(0);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0].message).toBe("Recovered");
  });

  test("emits a final assistant message when a later step-finish part carries the stop signal", async () => {
    const emitted = await runEventStream([
      makeMessagePartUpdatedEvent({
        messageId: "assistant-message-late-stop-part",
        partId: "text-late-stop-part-1",
        text: "Recovered after late stop",
      }),
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-late-stop-part",
        completedAt: 1,
      }),
      makeAssistantStepFinishPartUpdatedEvent({
        messageId: "assistant-message-late-stop-part",
        partId: "step-finish-late-stop-part-1",
      }),
      makeSessionIdleEvent(),
    ]);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0].message).toBe("Recovered after late stop");

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("does not settle assistant turns from step-finish error parts", async () => {
    const emitted = await runEventStream([
      makeMessagePartUpdatedEvent({
        messageId: "assistant-message-step-error",
        partId: "text-step-error-1",
        text: "Retryable intermediate output",
      }),
      makeAssistantStepFinishPartUpdatedEvent({
        messageId: "assistant-message-step-error",
        partId: "step-finish-error-part-1",
        reason: "error",
      }),
    ]);

    expect(emitted.some((event) => event.type === "assistant_message")).toBe(false);
    expect(emitted.some((event) => event.type === "session_idle")).toBe(false);
  });

  test("keeps assistant completion monotonic when stale non-terminal updates arrive later", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession([
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-stale-update",
        finish: "stop",
        completedAt: 1,
        text: "Done",
        partId: "text-stale-update-1",
      }),
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-stale-update",
      }),
      makeMessagePartDeltaEvent({
        messageId: "assistant-message-stale-update",
        partId: "text-stale-update-1",
        field: "text",
        delta: " later",
      }),
      makeSessionStatusIdleEvent(),
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(2);
    expect(emitted.filter((event) => event.type === "assistant_delta")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(0);
    expect(sessionRecord.completedAssistantMessageIds.has("assistant-message-stale-update")).toBe(
      true,
    );
    expect(sessionRecord.activeAssistantMessageId).toBeNull();

    const updatedPart = sessionRecord.partsById.get("text-stale-update-1");
    if (updatedPart?.type !== "text") {
      throw new Error("Expected cached assistant text part");
    }
    expect(updatedPart.text).toBe("Done later");
  });

  test("replays known assistant parts when the assistant role becomes known later", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-late-role-1",
            sessionID: "external-session-1",
            messageID: "assistant-message-late-role-1",
            type: "text",
            text: "Late role text",
          },
        },
      }),
      assistantRoleEvent("assistant-message-late-role-1"),
    ]);

    const partEvents = emitted.filter((event) => event.type === "assistant_part");
    expect(partEvents).toHaveLength(1);
    if (partEvents[0]?.type !== "assistant_part" || partEvents[0].part.kind !== "text") {
      throw new Error("Expected assistant text part event");
    }
    expect(partEvents[0].part.text).toBe("Late role text");
  });

  test("normalizes todo.updated and ignores unrelated sessions", async () => {
    const { emitted } = await runEventStreamWithSession([
      createInvalidFixture<Event>({
        type: "todo.updated",
        properties: {
          sessionID: "external-other-session",
          todos: [{ content: "ignored" }],
        },
      }),
      createInvalidFixture<Event>({
        type: "todo.updated",
        properties: {
          sessionID: "external-session-1",
          todos: [
            {
              content: "Implement tests",
              status: "active",
            },
          ],
        },
      }),
    ]);

    const todoEvents = emitted.filter((event) => event.type === "session_todos_updated");
    expect(todoEvents).toHaveLength(1);
    if (todoEvents[0]?.type !== "session_todos_updated") {
      throw new Error("Expected session_todos_updated event");
    }
    expect(todoEvents[0].todos).toEqual([
      {
        id: "todo:0",
        content: "Implement tests",
        status: "in_progress",
        priority: "medium",
      },
    ]);
  });

  test("routes directory-scoped global events only to matching working directories", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "session.idle",
        properties: {
          directory: "/other",
        },
      }),
      createInvalidFixture<Event>({
        type: "session.idle",
        properties: {
          directory: "/repo",
        },
      }),
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("forwards every raw sdk event to logEvent before relevance filtering", async () => {
    const logs: Array<{ type: string; relevant: boolean }> = [];

    await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "todo.updated",
          properties: {
            sessionID: "external-other-session",
            todos: [{ content: "ignored" }],
          },
        }),
        createInvalidFixture<Event>({
          type: "todo.updated",
          properties: {
            sessionID: "external-session-1",
            todos: [{ content: "handled" }],
          },
        }),
      ],
      undefined,
      {
        logEvent: (entry) => {
          logs.push({ type: entry.event.type, relevant: entry.relevant });
        },
      },
    );

    expect(logs).toEqual([
      { type: "todo.updated", relevant: false },
      { type: "todo.updated", relevant: true },
    ]);
  });

  test("treats known child-session events as relevant to the parent subscriber", () => {
    const childPermissionEvent = permissionAskedEvent({
      requestId: "perm-child-1",
      sessionId: "external-child-session",
      permission: "read",
    });
    const childMessageEvent = createInvalidFixture<Event>({
      type: "message.updated",
      properties: {
        info: {
          id: "child-message-1",
          role: "assistant",
          sessionID: "external-child-session",
        },
      },
    });
    const parentSubscriber = {
      externalSessionId: "external-parent-session",
      input: makeSessionInput(),
    };

    expect(isRelevantSubscriberEvent(parentSubscriber, childPermissionEvent)).toBe(false);
    expect(
      isRelevantSubscriberEvent(parentSubscriber, childPermissionEvent, {
        resolveParentExternalSessionId: (externalSessionId) =>
          externalSessionId === "external-child-session"
            ? parentSubscriber.externalSessionId
            : undefined,
      }),
    ).toBe(true);
    expect(
      isRelevantSubscriberEvent(parentSubscriber, childMessageEvent, {
        resolveParentExternalSessionId: (externalSessionId) =>
          externalSessionId === "external-child-session"
            ? parentSubscriber.externalSessionId
            : undefined,
      }),
    ).toBe(false);
  });

  test("prefers explicit pending-input parents over conflicting confirmed lineage", () => {
    const confirmedParentSubscriber = {
      externalSessionId: "external-confirmed-parent",
      input: makeSessionInput(),
    };
    const explicitParentSubscriber = {
      externalSessionId: "external-explicit-parent",
      input: makeSessionInput(),
    };
    const resolveConfirmedParent = (externalSessionId: string) =>
      externalSessionId === "external-child-session"
        ? confirmedParentSubscriber.externalSessionId
        : undefined;

    for (const eventType of [
      "permission.asked",
      "permission.v2.asked",
      "permission.replied",
      "question.asked",
      "question.replied",
    ] as const) {
      const event = createInvalidFixture<Event>({
        type: eventType,
        properties: {
          sessionID: "external-child-session",
          parentID: explicitParentSubscriber.externalSessionId,
        },
      });

      expect(
        isRelevantSubscriberEvent(confirmedParentSubscriber, event, {
          resolveParentExternalSessionId: resolveConfirmedParent,
        }),
      ).toBe(false);
      expect(
        isRelevantSubscriberEvent(explicitParentSubscriber, event, {
          resolveParentExternalSessionId: resolveConfirmedParent,
        }),
      ).toBe(true);
    }
  });

  test("does not treat a top-level lifecycle parent id as authoritative", () => {
    const childSessionCreatedEvent = createInvalidFixture<Event>({
      type: "session.created",
      properties: {
        parentID: "external-parent-session",
        info: {
          id: "external-child-session",
        },
      },
    });
    const parentSubscriber = {
      externalSessionId: "external-parent-session",
      input: makeSessionInput(),
    };
    const otherSubscriber = {
      externalSessionId: "other-parent-session",
      input: makeSessionInput(),
    };

    expect(isRelevantSubscriberEvent(parentSubscriber, childSessionCreatedEvent)).toBe(false);
    expect(isRelevantSubscriberEvent(otherSubscriber, childSessionCreatedEvent)).toBe(false);
  });

  test("does not treat lifecycle parent aliases as authoritative", () => {
    const parentSubscriber = {
      externalSessionId: "external-parent-session",
      input: makeSessionInput(),
    };

    for (const parentAlias of ["parentId", "parent_id"] as const) {
      const lifecycleEvent = childSessionCreatedEventWithParentAlias(
        "external-child-session",
        parentAlias,
        parentSubscriber.externalSessionId,
      );

      expect(isRelevantSubscriberEvent(parentSubscriber, lifecycleEvent)).toBe(false);
    }
  });

  test("does not bind child correlation from lifecycle parent aliases", () => {
    for (const parentAlias of ["parentId", "parent_id"] as const) {
      const sessionRecord = makeSessionRecord(makeClientWithEvents([]));
      sessionRecord.pendingSubagentCorrelationKeys.push("part:assistant-1:subtask-1");
      const lifecycleEvent = childSessionCreatedEventWithParentAlias(
        "external-child-session",
        parentAlias,
        sessionRecord.externalSessionId,
      );

      processOpencodeEvent({
        externalSessionId: sessionRecord.externalSessionId,
        input: sessionRecord.input,
        session: sessionRecord,
        event: lifecycleEvent,
        now: () => "2026-02-22T12:00:00.000Z",
        emit: () => undefined,
      });

      expect(
        sessionRecord.pendingSubagentSessionsByExternalSessionId.has("external-child-session"),
      ).toBe(false);
      expect(
        sessionRecord.subagentCorrelationKeyByExternalSessionId.has("external-child-session"),
      ).toBe(false);
    }
  });

  test("does not treat same-directory child input events as parent-owned without a child link", () => {
    const parentSubscriber = {
      externalSessionId: "external-parent-session",
      input: makeSessionInput(),
    };
    const childPermissionEvent = permissionAskedEvent({
      requestId: "perm-child-1",
      sessionId: "external-child-session",
      permission: "read",
      properties: { directory: "/repo" },
    });

    expect(isRelevantSubscriberEvent(parentSubscriber, childPermissionEvent)).toBe(false);
  });

  test("applies queued part delta with append semantics", async () => {
    const emitted = await runEventStream([
      assistantRoleEvent("assistant-message-2"),
      createInvalidFixture<Event>({
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-1",
          messageID: "assistant-message-2",
          field: "text",
          delta: " world",
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-1",
            sessionID: "external-session-1",
            messageID: "assistant-message-2",
            type: "text",
            text: "Hello",
            time: { start: 1, end: 2 },
          },
        },
      }),
    ]);

    const deltas = emitted.filter((event) => event.type === "assistant_delta");
    expect(deltas).toHaveLength(0);
    const parts = emitted.filter((event) => event.type === "assistant_part");
    expect(parts).toHaveLength(1);
    if (parts[0]?.type !== "assistant_part") {
      throw new Error("Expected assistant_part event");
    }
    expect(parts[0].part.kind).toBe("text");
    if (parts[0].part.kind !== "text") {
      throw new Error("Expected text assistant part");
    }
    expect(parts[0].part.text).toBe("Hello world");
  });

  test("replays queued deltas in FIFO order", async () => {
    const emitted = await runEventStream([
      assistantRoleEvent("assistant-message-fifo"),
      createInvalidFixture<Event>({
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-fifo",
          messageID: "assistant-message-fifo",
          field: "text",
          delta: " world",
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-fifo",
          messageID: "assistant-message-fifo",
          field: "text",
          delta: "!",
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-fifo",
            sessionID: "external-session-1",
            messageID: "assistant-message-fifo",
            type: "text",
            text: "Hello",
            time: { start: 1, end: 2 },
          },
        },
      }),
    ]);

    const parts = emitted.filter((event) => event.type === "assistant_part");
    expect(parts).toHaveLength(1);
    if (parts[0]?.type !== "assistant_part" || parts[0].part.kind !== "text") {
      throw new Error("Expected assistant text part");
    }
    expect(parts[0].part.text).toBe("Hello world!");
  });

  test("keeps known-part and queued-part delta application consistent", async () => {
    const queuedPath = await runEventStream([
      assistantRoleEvent("assistant-message-consistency"),
      createInvalidFixture<Event>({
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-consistency",
          messageID: "assistant-message-consistency",
          field: "text",
          delta: " world",
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-consistency",
            sessionID: "external-session-1",
            messageID: "assistant-message-consistency",
            type: "text",
            text: "Hello",
            time: { start: 1, end: 2 },
          },
        },
      }),
    ]);

    const knownPath = await runEventStream([
      assistantRoleEvent("assistant-message-consistency"),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-consistency",
            sessionID: "external-session-1",
            messageID: "assistant-message-consistency",
            type: "text",
            text: "Hello",
            time: { start: 1, end: 2 },
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-consistency",
          messageID: "assistant-message-consistency",
          field: "text",
          delta: " world",
        },
      }),
    ]);

    const queuedParts = queuedPath.filter((event) => event.type === "assistant_part");
    const knownParts = knownPath.filter((event) => event.type === "assistant_part");
    const lastQueued = queuedParts[queuedParts.length - 1];
    const lastKnown = knownParts[knownParts.length - 1];
    if (
      lastQueued?.type !== "assistant_part" ||
      lastQueued.part.kind !== "text" ||
      !lastKnown ||
      lastKnown.type !== "assistant_part" ||
      lastKnown.part.kind !== "text"
    ) {
      throw new Error("Expected final assistant text parts");
    }
    expect(lastQueued.part.text).toBe("Hello world");
    expect(lastKnown.part.text).toBe("Hello world");
  });

  test("suppresses assistant_delta when delta belongs to user message", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-1",
            role: "user",
            sessionID: "external-session-1",
          },
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          messageID: "user-message-1",
          delta: "typing...",
        },
      }),
    ]);

    expect(emitted.filter((event) => event.type === "assistant_delta")).toHaveLength(0);
  });

  test("emits reasoning channel for reasoning fallback deltas", async () => {
    const emitted = await runEventStream([
      assistantRoleEvent("assistant-message-reasoning"),
      createInvalidFixture<Event>({
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          messageID: "assistant-message-reasoning",
          field: "reasoning_content",
          delta: "Hidden chain of thought",
        },
      }),
    ]);

    const deltas = emitted.filter((event) => event.type === "assistant_delta");
    expect(deltas).toHaveLength(1);
    if (deltas[0]?.type !== "assistant_delta") {
      throw new Error("Expected assistant_delta event");
    }
    expect(deltas[0]).toMatchObject({
      channel: "reasoning",
      messageId: "assistant-message-reasoning",
      delta: "Hidden chain of thought",
    });
  });

  test("suppresses non-assistant reasoning parts", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-reasoning",
            role: "user",
            sessionID: "external-session-1",
          },
          parts: [
            {
              id: "reasoning-user-1",
              sessionID: "external-session-1",
              messageID: "user-message-reasoning",
              type: "reasoning",
              text: "Should not surface",
              time: { start: 1, end: 2 },
            },
          ],
        },
      }),
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(0);
  });

  test("emits retry session_status payload", async () => {
    const emitted = await runEventStream([
      sessionStatusEvent({
        type: "retry",
        attempt: 2,
        message: "Retrying request",
        next: 250,
      }),
    ]);

    const statusEvents = emitted.filter((event) => event.type === "session_status");
    expect(statusEvents).toHaveLength(1);
    if (statusEvents[0]?.type !== "session_status") {
      throw new Error("Expected session_status event");
    }
    expect(statusEvents[0].status).toEqual({
      type: "retry",
      attempt: 2,
      message: "Retrying request",
      nextEpochMs: 250,
    });
  });

  test("routes malformed session.status events to a stream fault", async () => {
    const emitted = await runEventStream([
      malformedControlEvent("session.status", {
        sessionID: "external-session-1",
        status: { type: "reconnect", attempt: 3, message: "Reconnecting", next: 500 },
      }),
    ]);

    expect(emitted.filter((event) => event.type === "session_status")).toHaveLength(0);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "session_error",
        externalSessionId: "external-session-1",
        message: expect.stringContaining("session.status"),
      }),
    );
  });

  test("routes a malformed question option to a stream fault without partial consumption", async () => {
    for (const type of ["question.asked", "question.v2.asked"] as const) {
      const emitted = await runEventStream([
        malformedControlEvent(type, {
          sessionID: "external-session-1",
          id: `q-malformed-${type}`,
          questions: [
            {
              header: "Valid",
              question: "This entry must not be emitted",
              options: [{ label: "A", description: "Option A" }],
            },
            {
              header: "Malformed",
              question: "Pick target",
              options: [{ label: "B" }],
            },
          ],
        }),
      ]);

      expect(emitted.filter((event) => event.type === "question_required")).toHaveLength(0);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(
        expect.objectContaining({
          type: "session_error",
          externalSessionId: "external-session-1",
          message: expect.stringContaining(type),
        }),
      );
    }
  });

  test("routes malformed replied and rejected variants to one stream fault without resolution", async () => {
    const malformedEvents = [
      malformedControlEvent("permission.v2.replied", {
        sessionID: "external-session-1",
        requestID: "perm-v2-malformed",
      }),
      malformedControlEvent("question.replied", {
        sessionID: "external-session-1",
        requestID: "question-legacy-replied-malformed",
      }),
      malformedControlEvent("question.v2.replied", {
        sessionID: "external-session-1",
        requestID: "question-v2-replied-malformed",
      }),
      malformedControlEvent("question.rejected", {
        sessionID: "external-session-1",
      }),
      malformedControlEvent("question.v2.rejected", {
        sessionID: "external-session-1",
      }),
    ];

    for (const malformedEvent of malformedEvents) {
      const emitted = await runEventStream([malformedEvent]);

      expect(
        emitted.filter(
          (event) => event.type === "approval_resolved" || event.type === "question_resolved",
        ),
      ).toHaveLength(0);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(
        expect.objectContaining({
          type: "session_error",
          externalSessionId: "external-session-1",
          message: expect.stringContaining(malformedEvent.type),
        }),
      );
    }
  });

  test("forwards permission and question events", async () => {
    const emitted = await runEventStream([
      permissionAskedEvent({
        requestId: "perm-1",
        permission: "write",
        patterns: ["src/**"],
        metadata: { reason: "Need file write" },
      }),
      questionAskedEvent({
        requestId: "q-1",
        questions: [
          {
            header: "Scope",
            question: "Pick target",
            options: [{ label: "A", description: "Option A" }],
            custom: true,
          },
        ],
      }),
    ]);

    const permissionEvents = emitted.filter((event) => event.type === "approval_required");
    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(permissionEvents).toHaveLength(1);
    expect(questionEvents).toHaveLength(1);
    if (permissionEvents[0]?.type !== "approval_required") {
      throw new Error("Expected approval_required event");
    }
    if (questionEvents[0]?.type !== "question_required") {
      throw new Error("Expected question_required event");
    }
    expect(permissionEvents[0]).toMatchObject({
      requestType: "permission_grant",
      title: "Approve permission: write",
      affectedPaths: ["src/**"],
      action: { name: "write" },
      mutation: "mutating",
      supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
      metadata: {
        opencode: {
          permission: "write",
          patterns: ["src/**"],
          metadata: { reason: "Need file write" },
        },
      },
    });
    expect(permissionEvents[0].childExternalSessionId).toBe("external-session-1");
    expect(permissionEvents[0].parentExternalSessionId).toBeUndefined();
    expect(permissionEvents[0].subagentCorrelationKey).toBeUndefined();
    expect(questionEvents[0].childExternalSessionId).toBe("external-session-1");
    expect(questionEvents[0].parentExternalSessionId).toBeUndefined();
    expect(questionEvents[0].subagentCorrelationKey).toBeUndefined();
    expect(questionEvents[0].questions).toHaveLength(1);
    expect(questionEvents[0].questions[0]?.header).toBe("Scope");
  });

  test("emits one approval_resolved event for permission.v2.replied", async () => {
    const emitted = await runEventStream([
      permissionV2RepliedEvent({ requestId: "perm-v2-resolved", reply: "always" }),
    ]);

    expect(emitted).toEqual([
      {
        type: "approval_resolved",
        externalSessionId: "external-session-1",
        timestamp: "2026-02-22T12:00:00.000Z",
        requestId: "perm-v2-resolved",
        childExternalSessionId: "external-session-1",
      },
    ]);
  });

  test("emits one required and one resolved event for question.v2 asked and replied", async () => {
    const emitted = await runEventStream([
      questionV2AskedEvent({
        requestId: "question-v2-1",
        questions: [
          {
            header: "Scope",
            question: "Pick targets",
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
            multiple: true,
          },
        ],
      }),
      questionV2RepliedEvent({
        requestId: "question-v2-1",
        answers: [["A", "B"]],
      }),
    ]);

    expect(emitted).toEqual([
      {
        type: "question_required",
        externalSessionId: "external-session-1",
        timestamp: "2026-02-22T12:00:00.000Z",
        requestId: "question-v2-1",
        childExternalSessionId: "external-session-1",
        questions: [
          {
            header: "Scope",
            question: "Pick targets",
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
            multiple: true,
          },
        ],
      },
      {
        type: "question_resolved",
        externalSessionId: "external-session-1",
        timestamp: "2026-02-22T12:00:00.000Z",
        requestId: "question-v2-1",
        childExternalSessionId: "external-session-1",
      },
    ]);
  });

  test("maps legacy and v2 question replies and rejections to one question_resolved event", async () => {
    const variants = [
      questionRepliedEvent({ requestId: "question-legacy-replied", answers: [["A"]] }),
      questionRejectedEvent({ requestId: "question-legacy-rejected" }),
      questionV2RepliedEvent({ requestId: "question-v2-replied", answers: [["A"]] }),
      questionV2RejectedEvent({ requestId: "question-v2-rejected" }),
    ];

    for (const variant of variants) {
      const emitted = await runEventStream([variant]);

      expect(emitted).toEqual([
        {
          type: "question_resolved",
          externalSessionId: "external-session-1",
          timestamp: "2026-02-22T12:00:00.000Z",
          requestId: variant.properties.requestID,
          childExternalSessionId: "external-session-1",
        },
      ]);
    }
  });

  test("runtime event transport forwards known child question events to parent subscribers", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        childSessionCreatedEvent("external-child-session"),
        questionAskedEvent({
          requestId: "question-child-1",
          sessionId: "external-child-session",
        }),
      ],
      (session) => {
        session.subagentCorrelationKeyByExternalSessionId.set(
          "external-child-session",
          "part:assistant-1:subtask-1",
        );
      },
    );

    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0]).toMatchObject({
      type: "question_required",
      externalSessionId: "external-session-1",
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    });
  });

  test("forwards child question events with parent id before the child link is known", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        questionAskedEvent({
          requestId: "question-child-1",
          sessionId: "external-child-session",
          properties: { parentID: "external-session-1" },
        }),
      ],
      undefined,
    );

    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0]).toMatchObject({
      type: "question_required",
      externalSessionId: "external-session-1",
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
    });
    expect(questionEvents[0].subagentCorrelationKey).toBeUndefined();
  });

  test("correlates child question events immediately when a pending subagent key exists", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        questionAskedEvent({
          requestId: "question-child-1",
          sessionId: "external-child-session",
          properties: { info: { parentID: "external-session-1" } },
        }),
        {
          id: "event-child-session-updated",
          type: "session.updated",
          properties: {
            sessionID: "external-child-session",
            info: childSessionInfo("external-child-session", "external-session-1"),
          },
        } satisfies EventSessionUpdated,
      ],
      (session) => {
        session.pendingSubagentCorrelationKeys.push("part:assistant-1:subtask-1");
      },
    );

    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0]).toMatchObject({
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    });
  });

  test("does not consume a pending subagent key for child input events from another directory", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [
        questionAskedEvent({
          requestId: "question-child-1",
          sessionId: "external-child-session",
          properties: {
            directory: "/other",
            info: { parentID: "external-session-1" },
          },
        }),
      ],
      (session) => {
        session.pendingSubagentCorrelationKeys.push("part:assistant-1:subtask-1");
      },
    );

    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0]).toMatchObject({
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
    });
    expect(questionEvents[0]).not.toHaveProperty("subagentCorrelationKey");
    expect(sessionRecord.pendingSubagentCorrelationKeys).toEqual(["part:assistant-1:subtask-1"]);
    expect(
      sessionRecord.subagentCorrelationKeyByExternalSessionId.has("external-child-session"),
    ).toBe(false);
  });

  test("correlates child question events with the running subagent card before completion arrives", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-question-bind"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-question-bind",
        partId: "subtask-a",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting A",
      }),
      questionAskedEvent({
        requestId: "question-child-1",
        sessionId: "external-child-session",
        properties: { info: { parentID: "external-session-1" } },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "subtask-a",
            sessionID: "external-session-1",
            messageID: "assistant-subagent-question-bind",
            type: "tool",
            callID: "call-subtask-a",
            tool: "delegate",
            state: {
              status: "completed",
              input: {
                agent: "build",
                prompt: "Inspect repo",
              },
              output: {
                result: "Finished A",
                externalSessionId: "external-child-session",
              },
            },
          },
        },
      }),
    ]);

    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0]).toMatchObject({
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-subagent-question-bind:subtask-a",
    });

    const subagentParts = emitted.flatMap((event) =>
      event.type === "assistant_part" && event.part.kind === "subagent" ? [event.part] : [],
    );
    expect(subagentParts.map((part) => part.externalSessionId)).toEqual([
      undefined,
      "external-child-session",
      "external-child-session",
    ]);
  });

  test("runtime event transport forwards known child permission events to parent subscribers", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        childSessionCreatedEvent("external-child-session"),
        permissionAskedEvent({
          requestId: "perm-child-1",
          sessionId: "external-child-session",
          permission: "read",
        }),
      ],
      (session) => {
        session.subagentCorrelationKeyByExternalSessionId.set(
          "external-child-session",
          "part:assistant-1:subtask-1",
        );
      },
    );

    const permissionEvents = emitted.filter((event) => event.type === "approval_required");
    expect(permissionEvents).toHaveLength(1);
    expect(permissionEvents[0]).toMatchObject({
      type: "approval_required",
      externalSessionId: "external-session-1",
      requestId: "perm-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    });
  });

  test("runtime event transport forwards known child permission v2 events to parent subscribers", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        childSessionCreatedEvent("external-child-session"),
        permissionV2AskedEvent({
          requestId: "perm-child-v2-1",
          sessionId: "external-child-session",
          action: "edit",
        }),
      ],
      (session) => {
        session.subagentCorrelationKeyByExternalSessionId.set(
          "external-child-session",
          "part:assistant-1:subtask-1",
        );
      },
    );

    const permissionEvents = emitted.filter((event) => event.type === "approval_required");
    expect(permissionEvents).toHaveLength(1);
    expect(permissionEvents[0]).toMatchObject({
      type: "approval_required",
      externalSessionId: "external-session-1",
      requestId: "perm-child-v2-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    });
  });

  test("runtime event transport forwards known child permission resolved events to parent subscribers", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        childSessionCreatedEvent("external-child-session"),
        permissionRepliedEvent({
          requestId: "perm-child-1",
          sessionId: "external-child-session",
        }),
      ],
      (session) => {
        session.subagentCorrelationKeyByExternalSessionId.set(
          "external-child-session",
          "part:assistant-1:subtask-1",
        );
      },
    );

    const resolvedEvents = emitted.filter((event) => event.type === "approval_resolved");
    expect(resolvedEvents).toHaveLength(1);
    expect(resolvedEvents[0]).toMatchObject({
      type: "approval_resolved",
      externalSessionId: "external-session-1",
      requestId: "perm-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    });
  });

  test("removes a queued child question when OpenCode resolves it before correlation", async () => {
    const { sessionRecord } = await runEventStreamWithSession([
      createInvalidFixture<Event>({
        type: "question.asked",
        properties: {
          sessionID: "external-child-session",
          parentID: "external-session-1",
          id: "question-child-1",
          questions: [
            {
              header: "Scope",
              question: "Pick target",
              options: [{ label: "A", description: "Option A" }],
            },
          ],
        },
      }),
      createInvalidFixture<Event>({
        type: "question.replied",
        properties: {
          sessionID: "external-child-session",
          parentID: "external-session-1",
          requestID: "question-child-1",
        },
      }),
    ]);

    expect(
      sessionRecord.pendingSubagentInputEventsByExternalSessionId.get("external-child-session"),
    ).toBeUndefined();
  });

  test("forwards child permission events with parent id before the child link is known", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        permissionAskedEvent({
          requestId: "perm-child-1",
          sessionId: "external-child-session",
          permission: "read",
          properties: { parentID: "external-session-1" },
        }),
      ],
      undefined,
    );

    const permissionEvents = emitted.filter((event) => event.type === "approval_required");
    expect(permissionEvents).toHaveLength(1);
    expect(permissionEvents[0]).toMatchObject({
      type: "approval_required",
      externalSessionId: "external-session-1",
      requestId: "perm-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
    });
    expect(permissionEvents[0].subagentCorrelationKey).toBeUndefined();
  });

  test("runtime event transport ignores child permission links for other parents", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        permissionAskedEvent({
          requestId: "perm-child-1",
          sessionId: "external-child-session",
          permission: "read",
        }),
      ],
      undefined,
    );

    expect(emitted.filter((event) => event.type === "approval_required")).toHaveLength(0);
  });

  test("forwards subagent session linkage on child permission events", () => {
    const emitted: AgentEvent[] = [];
    const client = makeClientWithEvents([]);
    const sessionRecord = makeSessionRecord(client);

    processOpencodeEvent({
      externalSessionId: "external-child-session",
      input: makeSessionInput(),
      session: sessionRecord,
      event: permissionAskedEvent({
        requestId: "perm-child-1",
        sessionId: "external-child-session",
        permission: "read",
      }),
      now: () => "2026-02-22T12:00:00.000Z",
      emit: (_sessionId, event) => emitted.push(event),
      resolveSubagentSessionLink: (childExternalSessionId) =>
        childExternalSessionId === "external-child-session"
          ? {
              parentExternalSessionId: "external-parent-session",
              childExternalSessionId,
              subagentCorrelationKey: "part:assistant-1:subtask-1",
            }
          : undefined,
    });

    expect(emitted).toHaveLength(1);
    const [permissionEvent] = emitted;
    if (permissionEvent?.type !== "approval_required") {
      throw new Error("Expected approval_required event");
    }
    expect(permissionEvent).toMatchObject({
      externalSessionId: "external-child-session",
      requestId: "perm-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-parent-session",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    });
  });

  test("clears pending deltas when message part is removed", async () => {
    const emitted = await runEventStream([
      assistantRoleEvent("assistant-message-3"),
      createInvalidFixture<Event>({
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-2",
          messageID: "assistant-message-3",
          field: "text",
          delta: "stale ",
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.removed",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-2",
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-2",
            sessionID: "external-session-1",
            messageID: "assistant-message-3",
            type: "text",
            text: "fresh",
            time: { start: 1, end: 2 },
          },
        },
      }),
    ]);

    const parts = emitted.filter((event) => event.type === "assistant_part");
    expect(parts).toHaveLength(1);
    if (parts[0]?.type !== "assistant_part") {
      throw new Error("Expected assistant_part event");
    }
    if (parts[0].part.kind !== "text") {
      throw new Error("Expected text assistant part");
    }
    expect(parts[0].part.text).toBe("fresh");
  });

  test("clears deferred pending subagent emissions when message part is removed", async () => {
    const { sessionRecord } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "message.part.removed",
          properties: {
            sessionID: "external-session-1",
            partID: "subtask-part-1",
          },
        }),
      ],
      (record) => {
        record.pendingSubagentPartEmissionsByExternalSessionId.set("child-session-1", [
          {
            part: createInvalidFixture<import("@opencode-ai/sdk/v2/client").Part>({
              id: "subtask-part-1",
              sessionID: "external-session-1",
              messageID: "assistant-message-4",
              type: "tool",
              tool: "task",
              callID: "call-1",
              state: {
                status: "running",
                input: {
                  subagent_type: "build",
                  prompt: "Review changes",
                },
                metadata: {
                  externalSessionId: "child-session-1",
                },
              },
            }),
          },
        ]);
      },
    );

    expect(sessionRecord.pendingSubagentPartEmissionsByExternalSessionId.size).toBe(0);
  });

  test("clears child queues when their subagent part is removed", async () => {
    const childExternalSessionId = "child-session-1";
    const correlationKey = "part:assistant-message-4:subtask-part-1";
    const { sessionRecord } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "message.part.removed",
          properties: {
            sessionID: "external-session-1",
            partID: "subtask-part-1",
          },
        }),
      ],
      (record) => {
        record.subagentCorrelationKeyByPartId.set("subtask-part-1", correlationKey);
        record.subagentCorrelationKeyByExternalSessionId.set(
          childExternalSessionId,
          correlationKey,
        );
        record.subagentPartIdByCorrelationKey.set(correlationKey, "subtask-part-1");
        record.subagentPartIdByExternalSessionId.set(childExternalSessionId, "subtask-part-1");
        record.pendingSubagentSessionsByExternalSessionId.set(childExternalSessionId, {
          arrivalOrder: 1,
        });
        record.pendingSubagentInputEventsByExternalSessionId.set(childExternalSessionId, []);
        record.pendingBackgroundTaskResultsByExternalSessionId.set(childExternalSessionId, []);
      },
    );

    expect(
      sessionRecord.pendingSubagentSessionsByExternalSessionId.has(childExternalSessionId),
    ).toBe(false);
    expect(
      sessionRecord.pendingSubagentInputEventsByExternalSessionId.has(childExternalSessionId),
    ).toBe(false);
    expect(
      sessionRecord.pendingBackgroundTaskResultsByExternalSessionId.has(childExternalSessionId),
    ).toBe(false);
  });

  test("keeps unrelated child work when one pending subagent part is removed", async () => {
    const childExternalSessionId = "child-session-1";
    const { sessionRecord } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "message.part.removed",
          properties: {
            sessionID: "external-session-1",
            partID: "subtask-part-1",
          },
        }),
      ],
      (record) => {
        record.pendingSubagentPartEmissionsByExternalSessionId.set(childExternalSessionId, [
          {
            part: createInvalidFixture<import("@opencode-ai/sdk/v2/client").Part>({
              id: "subtask-part-1",
              sessionID: "external-session-1",
              messageID: "assistant-message-4",
              type: "tool",
              tool: "task",
              callID: "call-1",
              state: { status: "running", input: {} },
            }),
          },
          {
            part: createInvalidFixture<import("@opencode-ai/sdk/v2/client").Part>({
              id: "subtask-part-2",
              sessionID: "external-session-1",
              messageID: "assistant-message-4",
              type: "tool",
              tool: "task",
              callID: "call-2",
              state: { status: "running", input: {} },
            }),
          },
        ]);
        record.pendingSubagentSessionsByExternalSessionId.set(childExternalSessionId, {
          arrivalOrder: 1,
        });
        record.pendingSubagentInputEventsByExternalSessionId.set(childExternalSessionId, []);
        record.pendingBackgroundTaskResultsByExternalSessionId.set(childExternalSessionId, []);
      },
    );

    expect(
      sessionRecord.pendingSubagentPartEmissionsByExternalSessionId
        .get(childExternalSessionId)
        ?.map((emission) => emission.part.id),
    ).toEqual(["subtask-part-2"]);
    expect(
      sessionRecord.pendingSubagentSessionsByExternalSessionId.has(childExternalSessionId),
    ).toBe(true);
    expect(
      sessionRecord.pendingSubagentInputEventsByExternalSessionId.has(childExternalSessionId),
    ).toBe(true);
    expect(
      sessionRecord.pendingBackgroundTaskResultsByExternalSessionId.has(childExternalSessionId),
    ).toBe(true);
  });

  test("normalizes unknown session error payload", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [
        createInvalidFixture<Event>({
          type: "session.error",
          properties: {
            sessionID: "external-session-1",
            error: { data: {} },
          },
        }),
      ],
      (session) => {
        session.isAwaitingRuntimeTurnStart = true;
      },
    );

    const errors = emitted.filter((event) => event.type === "session_error");
    expect(errors).toHaveLength(1);
    if (errors[0]?.type !== "session_error") {
      throw new Error("Expected session_error event");
    }
    expect(errors[0].message).toBe("Unknown session error");
    expect(sessionRecord.isAwaitingRuntimeTurnStart).toBe(false);
    expect(sessionRecord.streamTurnStatus).toBe("idle");
  });

  test("emits pending final output before a session error", async () => {
    const { emitted } = await runEventStreamWithSession([
      makeAssistantMessageUpdatedEvent({
        messageId: "assistant-message-error",
        finish: "stop",
        completedAt: 1,
        text: "Final output before error",
        partId: "text-error-1",
      }),
      createInvalidFixture<Event>({
        type: "session.error",
        properties: {
          sessionID: "external-session-1",
          error: { data: { message: "Provider failed" } },
        },
      }),
    ]);

    expect(emitted.filter((event) => event.type === "assistant_message")).toEqual([
      expect.objectContaining({ message: "Final output before error" }),
    ]);
    expect(emitted.at(-1)).toMatchObject({ type: "session_error", message: "Provider failed" });
  });

  test("does not replay duplicate delta after suppressed known user-part update", async () => {
    const emitted = await runEventStream([
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "message-dup-1",
            role: "user",
            sessionID: "external-session-1",
          },
          parts: [
            {
              id: "part-dup-1",
              sessionID: "external-session-1",
              messageID: "message-dup-1",
              type: "text",
              text: "hello",
              time: { start: 1, end: 2 },
            },
          ],
        },
      }),
      createInvalidFixture<Event>({
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          messageID: "message-dup-1",
          partID: "part-dup-1",
          field: "text",
          delta: " world",
        },
      }),
      createInvalidFixture<Event>({
        type: "message.updated",
        properties: {
          info: {
            id: "message-dup-1",
            role: "assistant",
            sessionID: "external-session-1",
            finish: "stop",
            time: { completed: 3 },
          },
          parts: [
            {
              id: "part-dup-1",
              sessionID: "external-session-1",
              messageID: "message-dup-1",
              type: "text",
              text: "hello world",
              time: { start: 1, end: 3 },
            },
          ],
        },
      }),
    ]);

    const parts = emitted.filter((event) => event.type === "assistant_part");
    expect(parts).toHaveLength(1);
    if (parts[0]?.type !== "assistant_part" || parts[0].part.kind !== "text") {
      throw new Error("Expected assistant text part event");
    }
    expect(parts[0].part.text).toBe("hello world");
  });
});
