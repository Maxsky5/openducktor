import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent, AgentModelSelection, AgentUserMessagePart } from "@openducktor/core";
import {
  isRelevantSubscriberEvent,
  processOpencodeEvent,
  subscribeOpencodeEvents,
} from "./event-stream";
import {
  flushPendingSubagentInputEventsForSession,
  type SubagentSessionLink,
} from "./event-stream/shared";
import type { SessionInput, SessionRecord } from "./types";
import {
  buildQueuedRequestAttachmentIdentitySignature,
  buildQueuedRequestSignature,
} from "./user-message-signatures";

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

const makeClientWithEvents = (events: Event[]): OpencodeClient => {
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

const makeSessionInput = (): SessionInput => ({
  externalSessionId: "external-session-1",
  repoPath: "/repo",
  runtimeKind: "opencode",
  runtimeConnection: {
    type: "local_http",
    endpoint: "http://127.0.0.1:12345",
    workingDirectory: "/repo",
  },
  workingDirectory: "/repo",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  systemPrompt: "System prompt",
});

const makeSessionRecord = (client: OpencodeClient): SessionRecord => ({
  summary: {
    externalSessionId: "external-session-1",
    role: "spec",
    scenario: "spec_initial",
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
  pendingSubagentCorrelationKeysBySignature: new Map(),
  pendingSubagentCorrelationKeys: [],
  pendingSubagentSessionsByExternalSessionId: new Map(),
  pendingSubagentPartEmissionsByExternalSessionId: new Map(),
  pendingSubagentInputEventsByExternalSessionId: new Map(),
});

const buildQueuedSignature = (message: string, model?: AgentModelSelection | null): string => {
  const parts: AgentUserMessagePart[] = [{ kind: "text", text: message }];
  return buildQueuedRequestSignature(parts, model ?? undefined);
};

const runEventStreamWithSession = async (
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

const runEventStream = async (events: Event[]): Promise<AgentEvent[]> => {
  return (await runEventStreamWithSession(events)).emitted;
};

test("flushPendingSubagentInputEventsForSession preserves original timestamps", () => {
  const emitted: AgentEvent[] = [];
  const runtime = {
    externalSessionId: "external-session-1",
    input: makeSessionInput() as any,
    now: () => "2026-02-22T12:30:00.000Z",
    emit: (_externalSessionId: string, event: AgentEvent) => {
      emitted.push(event);
    },
    getSession: () => undefined,
    subagentCorrelationKeyByPartId: new Map<string, string>(),
    subagentCorrelationKeyByExternalSessionId: new Map<string, string>([
      ["external-child-session", "part:assistant-1:subtask-1"],
    ]),
    pendingSubagentCorrelationKeysBySignature: new Map<string, string[]>(),
    pendingSubagentCorrelationKeys: [],
    pendingSubagentSessionsByExternalSessionId: new Map(),
    pendingSubagentPartEmissionsByExternalSessionId: new Map(),
    pendingSubagentInputEventsByExternalSessionId: new Map([
      [
        "external-child-session",
        [
          {
            type: "permission_required",
            externalSessionId: "external-session-1",
            timestamp: "2026-02-22T12:00:00.000Z",
            requestId: "perm-child-1",
            permission: "write",
            patterns: ["src/**"],
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
        ],
      ],
    ]),
  };

  flushPendingSubagentInputEventsForSession(runtime as any, "external-child-session");

  expect(emitted).toEqual([
    {
      type: "permission_required",
      externalSessionId: "external-session-1",
      timestamp: "2026-02-22T12:00:00.000Z",
      requestId: "perm-child-1",
      permission: "write",
      patterns: ["src/**"],
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
    runtime.pendingSubagentInputEventsByExternalSessionId.get("external-child-session"),
  ).toBeUndefined();
});

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

const makeSessionIdleEvent = (): Event =>
  ({
    type: "session.idle",
    properties: {
      sessionID: "external-session-1",
    },
  }) as unknown as Event;

const makeSessionStatusIdleEvent = (): Event =>
  ({
    type: "session.status",
    properties: {
      sessionID: "external-session-1",
      status: {
        type: "idle",
      },
    },
  }) as unknown as Event;

const makeAssistantTextPart = (input: {
  messageId: string;
  text: string;
  partId?: string;
  start?: number;
  end?: number;
}): Record<string, unknown> => ({
  id: input.partId ?? `${input.messageId}-text-1`,
  sessionID: "external-session-1",
  messageID: input.messageId,
  type: "text",
  text: input.text,
  time: {
    start: input.start ?? 1,
    end: input.end ?? 1,
  },
});

const makeAssistantMessageUpdatedEvent = (input: {
  messageId: string;
  text?: string;
  partId?: string;
  finish?: string;
  completedAt?: number;
  parts?: unknown[];
  info?: Record<string, unknown>;
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

  return {
    type: "message.updated",
    properties: {
      info: {
        id: input.messageId,
        role: "assistant",
        sessionID: "external-session-1",
        ...(input.finish ? { finish: input.finish } : {}),
        ...(input.completedAt !== undefined ? { time: { completed: input.completedAt } } : {}),
        ...input.info,
      },
      ...(parts ? { parts } : {}),
    },
  } as unknown as Event;
};

const makeMessagePartUpdatedEvent = (input: {
  messageId: string;
  partId: string;
  text: string;
  end?: number;
}): Event =>
  ({
    type: "message.part.updated",
    properties: {
      part: makeAssistantTextPart({
        messageId: input.messageId,
        partId: input.partId,
        text: input.text,
        end: input.end,
      }),
    },
  }) as unknown as Event;

const makeAssistantStepFinishPartUpdatedEvent = (input: {
  messageId: string;
  partId: string;
  reason?: string;
}): Event =>
  ({
    type: "message.part.updated",
    properties: {
      part: {
        id: input.partId,
        sessionID: "external-session-1",
        messageID: input.messageId,
        type: "step-finish",
        reason: input.reason ?? "stop",
      },
    },
  }) as unknown as Event;

const makeAssistantSubtaskPartUpdatedEvent = (input: {
  messageId: string;
  partId: string;
  agent: string;
  prompt: string;
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
        agent: input.agent,
        prompt: input.prompt,
        description: input.description,
      },
    },
  }) as unknown as Event;

const makeChildSessionCreatedEvent = (input: {
  childSessionId: string;
  parentExternalSessionId: string;
}): Event =>
  ({
    type: "session.created",
    properties: {
      sessionID: input.childSessionId,
      info: {
        id: input.childSessionId,
        slug: input.childSessionId,
        projectID: "project-1",
        directory: "/repo",
        title: input.childSessionId,
        version: "1",
        parentID: input.parentExternalSessionId,
        time: {
          created: Date.parse("2026-02-22T12:00:10.000Z"),
          updated: Date.parse("2026-02-22T12:00:10.000Z"),
        },
      },
    },
  }) as unknown as Event;

const makeMessagePartDeltaEvent = (input: {
  messageId: string;
  partId: string;
  field: string;
  delta: string;
}): Event =>
  ({
    type: "message.part.delta",
    properties: {
      sessionID: "external-session-1",
      partID: input.partId,
      messageID: input.messageId,
      field: input.field,
      delta: input.delta,
    },
  }) as unknown as Event;

describe("event-stream", () => {
  test("emits user_message when opencode acknowledges a user turn", async () => {
    const emitted = await runEventStream([
      {
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
      } as unknown as Event,
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
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    const latestUserMessage = userMessages[userMessages.length - 1];
    if (!latestUserMessage || latestUserMessage.type !== "user_message") {
      throw new Error("Expected user_message event");
    }

    expect(latestUserMessage.message).toBe(slashEnvelope);
    expect(latestUserMessage.parts).toEqual([{ kind: "text", text: slashEnvelope }]);
  });

  test("preserves visible user text when later file parts arrive without visible text parts", async () => {
    const emitted = await runEventStream([
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
      {
        type: "session.idle",
        properties: {
          sessionID: "external-session-1",
        },
      } as unknown as Event,
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
        {
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
        } as unknown as Event,
      ],
      (nextSessionRecord) => {
        nextSessionRecord.pendingQueuedUserMessages.push({
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

  test("ignores unrelated status fields when deriving explicit user message state", async () => {
    const emitted = await runEventStream([
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
        {
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
        } as unknown as Event,
      ],
      (nextSessionRecord) => {
        nextSessionRecord.activeAssistantMessageId = "msg-100";
        nextSessionRecord.pendingQueuedUserMessages.push(
          { signature: buildQueuedSignature("Ship it") },
          {
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
      { signature: buildQueuedSignature("Ship it") },
    ]);
  });

  test("preserves queued local attachment preview paths when the runtime echoes a non-file attachment url", async () => {
    const { emitted, sessionRecord } = await runEventStreamWithSession(
      [
        {
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
        } as unknown as Event,
      ],
      (nextSessionRecord) => {
        nextSessionRecord.pendingQueuedUserMessages.push({
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
    if (!userMessage || userMessage.type !== "user_message") {
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
        {
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
        } as unknown as Event,
        {
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
        } as unknown as Event,
      ],
      (nextSessionRecord) => {
        nextSessionRecord.messageRoleById.set("msg-attachment-partial-1", "user");
        nextSessionRecord.pendingQueuedUserMessages.push({
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
    if (!latestUserMessage || latestUserMessage.type !== "user_message") {
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
        {
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
        } as unknown as Event,
      ],
      (nextSessionRecord) => {
        nextSessionRecord.pendingQueuedUserMessages.push({
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
    if (!userMessage || userMessage.type !== "user_message") {
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
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
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

    const { emitted } = await runEventStreamWithSession([assistantEvent, assistantEvent]);

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

  test("emits session_idle for stop-finished assistant turns without visible text", async () => {
    const emitted = await runEventStream([
      {
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
            },
          ],
        },
      } as unknown as Event,
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
    expect(emitted.some((event) => event.type === "assistant_message")).toBe(false);
  });

  test("does not emit session_idle or final assistant_message when completion lacks a stop signal", async () => {
    const emitted = await runEventStream([
      {
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
      } as unknown as Event,
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
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
      {
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
      } as unknown as Event,
      {
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
      } as unknown as Event,
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

    const emitted = await runEventStream([terminalEvent, terminalEvent]);

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

  test("keeps late terminal part updates out of assistant_part emission once idle", async () => {
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
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(1);

    const updatedPart = sessionRecord.partsById.get("text-late-part-update-1");
    if (!updatedPart || updatedPart.type !== "text") {
      throw new Error("Expected cached assistant text part");
    }
    expect(updatedPart.text).toBe("Done later");
  });

  test("keeps late terminal part deltas out of assistant events once idle", async () => {
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
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "assistant_delta")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(1);

    const updatedPart = sessionRecord.partsById.get("text-late-delta-1");
    if (!updatedPart || updatedPart.type !== "text") {
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
    if (!updatedPart || updatedPart.type !== "text") {
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
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "assistant_delta")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "session_idle")).toHaveLength(1);
    expect(sessionRecord.completedAssistantMessageIds.has("assistant-message-stale-update")).toBe(
      true,
    );
    expect(sessionRecord.activeAssistantMessageId).toBeNull();

    const updatedPart = sessionRecord.partsById.get("text-stale-update-1");
    if (!updatedPart || updatedPart.type !== "text") {
      throw new Error("Expected cached assistant text part");
    }
    expect(updatedPart.text).toBe("Done later");
  });

  test("replays known assistant parts when the assistant role becomes known later", async () => {
    const emitted = await runEventStream([
      {
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
      } as unknown as Event,
      assistantRoleEvent("assistant-message-late-role-1"),
    ]);

    const partEvents = emitted.filter((event) => event.type === "assistant_part");
    expect(partEvents).toHaveLength(1);
    if (partEvents[0]?.type !== "assistant_part" || partEvents[0].part.kind !== "text") {
      throw new Error("Expected assistant text part event");
    }
    expect(partEvents[0].part.text).toBe("Late role text");
  });

  test("binds same-turn sibling subagents to child sessions without fragmenting their cards", async () => {
    const emitted = await runEventStream([
      assistantRoleEvent("assistant-subagent-collision"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-collision",
        partId: "subtask-a",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting A",
      }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-collision",
        partId: "subtask-b",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting B",
      }),
      makeChildSessionCreatedEvent({
        childSessionId: "child-a",
        parentExternalSessionId: "external-session-1",
      }),
      makeChildSessionCreatedEvent({
        childSessionId: "child-b",
        parentExternalSessionId: "external-session-1",
      }),
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-a",
            sessionID: "external-session-1",
            messageID: "assistant-subagent-collision",
            callID: "call-a",
            type: "tool",
            tool: "delegate",
            state: {
              status: "completed",
              input: {
                agent: "build",
                prompt: "Inspect repo",
              },
              output: {
                result: "Finished A",
                externalSessionId: "child-a",
              },
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-b",
            sessionID: "external-session-1",
            messageID: "assistant-subagent-collision",
            callID: "call-b",
            type: "tool",
            tool: "delegate",
            state: {
              status: "completed",
              input: {
                agent: "build",
                prompt: "Inspect repo",
              },
              output: {
                result: "Finished B",
                externalSessionId: "child-b",
              },
            },
          },
        },
      } as unknown as Event,
    ]);

    const assistantPartEvents = emitted.filter(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part",
    );
    const subagentParts = assistantPartEvents
      .map((event): Extract<AgentEvent, { type: "assistant_part" }>["part"] => event.part)
      .filter(
        (
          part,
        ): part is Extract<
          Extract<AgentEvent, { type: "assistant_part" }>["part"],
          { kind: "subagent" }
        > => part.kind === "subagent",
      );

    expect(subagentParts).toHaveLength(4);

    const runningParts = subagentParts.filter((part) => part.status === "running");
    const completedParts = subagentParts.filter((part) => part.status === "completed");

    expect(runningParts).toHaveLength(2);
    expect(completedParts).toHaveLength(2);

    const runningKeys = runningParts.map((part) => part.correlationKey);
    expect(new Set(runningKeys).size).toBe(2);
    expect(runningKeys).toEqual([
      "part:assistant-subagent-collision:subtask-a",
      "part:assistant-subagent-collision:subtask-b",
    ]);

    expect(completedParts.map((part) => part.correlationKey)).toEqual([
      "part:assistant-subagent-collision:subtask-a",
      "part:assistant-subagent-collision:subtask-b",
    ]);
    expect(completedParts.map((part) => part.externalSessionId)).toEqual(["child-a", "child-b"]);
    expect(completedParts.map((part) => part.description)).toEqual(["Finished A", "Finished B"]);
  });

  test("keeps ambiguous sibling completions bound to their original cards even when they finish out of order", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-out-of-order"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-out-of-order",
        partId: "subtask-a",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting A",
      }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-out-of-order",
        partId: "subtask-b",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting B",
      }),
      makeChildSessionCreatedEvent({
        childSessionId: "child-a",
        parentExternalSessionId: "external-session-1",
      }),
      makeChildSessionCreatedEvent({
        childSessionId: "child-b",
        parentExternalSessionId: "external-session-1",
      }),
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-b",
            sessionID: "external-session-1",
            messageID: "assistant-subagent-out-of-order",
            callID: "call-b",
            type: "tool",
            tool: "delegate",
            state: {
              status: "completed",
              input: {
                agent: "build",
                prompt: "Inspect repo",
              },
              output: {
                result: "Finished B",
                externalSessionId: "child-b",
              },
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-a",
            sessionID: "external-session-1",
            messageID: "assistant-subagent-out-of-order",
            callID: "call-a",
            type: "tool",
            tool: "delegate",
            state: {
              status: "completed",
              input: {
                agent: "build",
                prompt: "Inspect repo",
              },
              output: {
                result: "Finished A",
                externalSessionId: "child-a",
              },
            },
          },
        },
      } as unknown as Event,
    ]);

    const assistantPartEvents = emitted.filter(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part",
    );
    const subagentParts = assistantPartEvents
      .map((event): Extract<AgentEvent, { type: "assistant_part" }>["part"] => event.part)
      .filter(
        (
          part,
        ): part is Extract<
          Extract<AgentEvent, { type: "assistant_part" }>["part"],
          { kind: "subagent" }
        > => part.kind === "subagent",
      );

    expect(subagentParts).toHaveLength(4);

    const runningParts = subagentParts.filter((part) => part.status === "running");
    const completedParts = subagentParts.filter((part) => part.status === "completed");

    expect(runningParts.map((part) => part.correlationKey)).toEqual([
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
    const emitted = await runEventStream([
      assistantRoleEvent("assistant-task-tool-running"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-task-tool-running",
        partId: "subtask-a",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting A",
      }),
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-a",
            sessionID: "external-session-1",
            messageID: "assistant-task-tool-running",
            callID: "call-a",
            type: "tool",
            tool: "task",
            state: {
              status: "running",
              input: {
                subagent_type: "build",
                prompt: "Inspect repo",
                description: "Starting A",
              },
              metadata: {
                externalSessionId: "child-a",
              },
            },
          },
        },
      } as unknown as Event,
    ]);

    const assistantPartEvents = emitted.filter(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part",
    );
    const subagentParts = assistantPartEvents
      .map((event): Extract<AgentEvent, { type: "assistant_part" }>["part"] => event.part)
      .filter(
        (
          part,
        ): part is Extract<
          Extract<AgentEvent, { type: "assistant_part" }>["part"],
          { kind: "subagent" }
        > => part.kind === "subagent",
      );

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
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting A",
      }),
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-a",
            sessionID: "external-session-1",
            messageID: "assistant-task-tool-running",
            callID: "call-a",
            type: "tool",
            tool: "task",
            state: {
              status: "running",
              input: {
                subagent_type: "build",
                prompt: "Inspect repo",
                description: "Starting A",
              },
              metadata: {
                externalSessionId: "child-a",
              },
            },
          },
        },
      } as unknown as Event,
    ]);

    expect(sessionRecord.subagentCorrelationKeyByExternalSessionId.get("child-a")).toBe(
      "part:assistant-task-tool-running:subtask-a",
    );
    expect(sessionRecord.pendingSubagentCorrelationKeys).toEqual([]);
    expect(sessionRecord.pendingSubagentCorrelationKeysBySignature.size).toBe(0);
  });

  test("binds sibling child sessions correctly when session.created arrives out of order", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-created-order"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-created-order",
        partId: "subtask-a",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting A",
      }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-created-order",
        partId: "subtask-b",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting B",
      }),
      {
        type: "session.created",
        properties: {
          info: {
            id: "child-b",
            parentID: "external-session-1",
            time: { created: Date.parse("2026-02-22T12:00:12.000Z") },
          },
        },
      } as unknown as Event,
      {
        type: "session.created",
        properties: {
          info: {
            id: "child-a",
            parentID: "external-session-1",
            time: { created: Date.parse("2026-02-22T12:00:10.000Z") },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-a",
            sessionID: "external-session-1",
            messageID: "assistant-subagent-created-order",
            callID: "call-a",
            type: "tool",
            tool: "delegate",
            state: {
              status: "completed",
              input: {
                agent: "build",
                prompt: "Inspect repo",
              },
              output: {
                result: "Finished A",
                externalSessionId: "child-a",
              },
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-b",
            sessionID: "external-session-1",
            messageID: "assistant-subagent-created-order",
            callID: "call-b",
            type: "tool",
            tool: "delegate",
            state: {
              status: "completed",
              input: {
                agent: "build",
                prompt: "Inspect repo",
              },
              output: {
                result: "Finished B",
                externalSessionId: "child-b",
              },
            },
          },
        },
      } as unknown as Event,
    ]);

    const completedSubagentParts = emitted.filter(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part" &&
        event.part.kind === "subagent" &&
        event.part.status === "completed",
    );

    expect(completedSubagentParts.map((event) => event.part.correlationKey)).toEqual([
      "part:assistant-subagent-created-order:subtask-a",
      "part:assistant-subagent-created-order:subtask-b",
    ]);
    expect(completedSubagentParts.map((event) => event.part.externalSessionId)).toEqual([
      "child-a",
      "child-b",
    ]);
  });

  test("defers ambiguous task tool updates until child sessions bind to spawned cards", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-ambiguous-deferred"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-ambiguous-deferred",
        partId: "subtask-a",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting A",
      }),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-ambiguous-deferred",
        partId: "subtask-b",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting B",
      }),
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-b",
            sessionID: "external-session-1",
            messageID: "assistant-subagent-ambiguous-deferred",
            callID: "call-b",
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              metadata: {
                agent: "build",
                prompt: "Inspect repo",
                externalSessionId: "child-b",
              },
            },
          },
        },
      } as unknown as Event,
      {
        type: "session.created",
        properties: {
          info: {
            id: "child-b",
            parentID: "external-session-1",
            time: { created: Date.parse("2026-02-22T12:00:12.000Z") },
          },
        },
      } as unknown as Event,
      {
        type: "session.created",
        properties: {
          info: {
            id: "child-a",
            parentID: "external-session-1",
            time: { created: Date.parse("2026-02-22T12:00:10.000Z") },
          },
        },
      } as unknown as Event,
    ]);

    const subagentParts = emitted.filter(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part" && event.part.kind === "subagent",
    );

    expect(subagentParts).toHaveLength(3);
    expect(subagentParts.map((event) => event.part.correlationKey)).toEqual([
      "part:assistant-subagent-ambiguous-deferred:subtask-a",
      "part:assistant-subagent-ambiguous-deferred:subtask-b",
      "part:assistant-subagent-ambiguous-deferred:subtask-b",
    ]);
    expect(subagentParts.map((event) => event.part.status)).toEqual([
      "running",
      "running",
      "completed",
    ]);
    expect(subagentParts.map((event) => event.part.externalSessionId)).toEqual([
      undefined,
      undefined,
      "child-b",
    ]);
  });

  test("normalizes todo.updated and ignores unrelated sessions", async () => {
    const { emitted } = await runEventStreamWithSession([
      {
        type: "todo.updated",
        properties: {
          sessionID: "external-other-session",
          todos: [{ content: "ignored" }],
        },
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
      {
        type: "session.idle",
        properties: {
          directory: "/other",
        },
      } as unknown as Event,
      {
        type: "session.idle",
        properties: {
          directory: "/repo",
        },
      } as unknown as Event,
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("forwards every raw sdk event to logEvent before relevance filtering", async () => {
    const client = makeClientWithEvents([
      {
        type: "todo.updated",
        properties: {
          sessionID: "external-other-session",
          todos: [{ content: "ignored" }],
        },
      } as unknown as Event,
      {
        type: "todo.updated",
        properties: {
          sessionID: "external-session-1",
          todos: [{ content: "handled" }],
        },
      } as unknown as Event,
    ]);
    const sessionRecord = makeSessionRecord(client);
    const logs: Array<{ type: string; relevant: boolean }> = [];

    await subscribeOpencodeEvents({
      context: {
        externalSessionId: "external-session-1",
        input: makeSessionInput(),
      },
      client,
      controller: new AbortController(),
      now: () => "2026-02-22T12:00:00.000Z",
      emit: () => undefined,
      getSession: () => sessionRecord,
      logEvent: (entry) => {
        logs.push({ type: entry.event.type, relevant: entry.relevant });
      },
    });

    expect(logs).toEqual([
      { type: "todo.updated", relevant: false },
      { type: "todo.updated", relevant: true },
    ]);
  });

  test("treats known child-session events as relevant to the parent subscriber", () => {
    const childPermissionEvent = {
      type: "permission.asked",
      properties: {
        sessionID: "external-child-session",
        id: "perm-child-1",
        permission: "read",
        patterns: ["src/**"],
      },
    } as unknown as Event;
    const childMessageEvent = {
      type: "message.updated",
      properties: {
        info: {
          id: "child-message-1",
          role: "assistant",
          sessionID: "external-child-session",
        },
      },
    } as unknown as Event;
    const parentSubscriber = {
      externalSessionId: "external-parent-session",
      input: makeSessionInput(),
    };

    expect(isRelevantSubscriberEvent(parentSubscriber, childPermissionEvent)).toBe(false);
    expect(
      isRelevantSubscriberEvent(parentSubscriber, childPermissionEvent, {
        isKnownChildExternalSessionId: (externalSessionId) =>
          externalSessionId === "external-child-session",
      }),
    ).toBe(true);
    expect(
      isRelevantSubscriberEvent(parentSubscriber, childMessageEvent, {
        isKnownChildExternalSessionId: (externalSessionId) =>
          externalSessionId === "external-child-session",
      }),
    ).toBe(false);
  });

  test("applies queued part delta with append semantics", async () => {
    const emitted = await runEventStream([
      assistantRoleEvent("assistant-message-2"),
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-1",
          messageID: "assistant-message-2",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-fifo",
          messageID: "assistant-message-fifo",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-fifo",
          messageID: "assistant-message-fifo",
          field: "text",
          delta: "!",
        },
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-consistency",
          messageID: "assistant-message-consistency",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
      {
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
      } as unknown as Event,
    ]);

    const knownPath = await runEventStream([
      assistantRoleEvent("assistant-message-consistency"),
      {
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
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-consistency",
          messageID: "assistant-message-consistency",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
    ]);

    const queuedParts = queuedPath.filter((event) => event.type === "assistant_part");
    const knownParts = knownPath.filter((event) => event.type === "assistant_part");
    const lastQueued = queuedParts[queuedParts.length - 1];
    const lastKnown = knownParts[knownParts.length - 1];
    if (
      !lastQueued ||
      lastQueued.type !== "assistant_part" ||
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
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-1",
            role: "user",
            sessionID: "external-session-1",
          },
        },
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          messageID: "user-message-1",
          delta: "typing...",
        },
      } as unknown as Event,
    ]);

    expect(emitted.filter((event) => event.type === "assistant_delta")).toHaveLength(0);
  });

  test("emits reasoning channel for reasoning fallback deltas", async () => {
    const emitted = await runEventStream([
      assistantRoleEvent("assistant-message-reasoning"),
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          messageID: "assistant-message-reasoning",
          field: "reasoning_content",
          delta: "Hidden chain of thought",
        },
      } as unknown as Event,
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
      {
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
      } as unknown as Event,
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(0);
  });

  test("emits retry session_status payload", async () => {
    const emitted = await runEventStream([
      {
        type: "session.status",
        properties: {
          sessionID: "external-session-1",
          status: {
            type: "retry",
            attempt: 2,
            message: "Retrying request",
            next: 250,
          },
        },
      } as unknown as Event,
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

  test("normalizes unknown session.status types as retry payload", async () => {
    const emitted = await runEventStream([
      {
        type: "session.status",
        properties: {
          sessionID: "external-session-1",
          status: {
            type: "reconnect",
            attempt: 3,
            message: "Reconnecting",
            next: 500,
          },
        },
      } as unknown as Event,
    ]);

    const statusEvents = emitted.filter((event) => event.type === "session_status");
    expect(statusEvents).toHaveLength(1);
    if (statusEvents[0]?.type !== "session_status") {
      throw new Error("Expected session_status event");
    }
    expect(statusEvents[0].status).toEqual({
      type: "retry",
      attempt: 3,
      message: "Reconnecting",
      nextEpochMs: 500,
    });
  });

  test("forwards permission and question events", async () => {
    const emitted = await runEventStream([
      {
        type: "permission.asked",
        properties: {
          sessionID: "external-session-1",
          id: "perm-1",
          permission: "write",
          patterns: ["src/**"],
          metadata: { reason: "Need file write" },
        },
      } as unknown as Event,
      {
        type: "question.asked",
        properties: {
          sessionID: "external-session-1",
          id: "q-1",
          questions: [
            {
              header: "Scope",
              question: "Pick target",
              options: [{ label: "A", description: "Option A" }],
              custom: true,
            },
          ],
        },
      } as unknown as Event,
    ]);

    const permissionEvents = emitted.filter((event) => event.type === "permission_required");
    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(permissionEvents).toHaveLength(1);
    expect(questionEvents).toHaveLength(1);
    if (permissionEvents[0]?.type !== "permission_required") {
      throw new Error("Expected permission_required event");
    }
    if (questionEvents[0]?.type !== "question_required") {
      throw new Error("Expected question_required event");
    }
    expect(permissionEvents[0].metadata).toEqual({ reason: "Need file write" });
    expect(permissionEvents[0].childExternalSessionId).toBe("external-session-1");
    expect(permissionEvents[0].parentExternalSessionId).toBeUndefined();
    expect(permissionEvents[0].parentExternalSessionId).toBeUndefined();
    expect(permissionEvents[0].subagentCorrelationKey).toBeUndefined();
    expect(questionEvents[0].childExternalSessionId).toBe("external-session-1");
    expect(questionEvents[0].parentExternalSessionId).toBeUndefined();
    expect(questionEvents[0].subagentCorrelationKey).toBeUndefined();
    expect(questionEvents[0].questions).toHaveLength(1);
    expect(questionEvents[0].questions[0]?.header).toBe("Scope");
  });

  test("subscribeOpencodeEvents forwards known child question events to parent subscribers", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        {
          type: "question.asked",
          properties: {
            sessionID: "external-child-session",
            id: "question-child-1",
            questions: [
              {
                header: "Scope",
                question: "Pick target",
                options: [{ label: "A", description: "Option A" }],
              },
            ],
          },
        } as unknown as Event,
      ],
      undefined,
      (childExternalSessionId) =>
        childExternalSessionId === "external-child-session"
          ? {
              parentExternalSessionId: "external-session-1",
              childExternalSessionId,
              subagentCorrelationKey: "part:assistant-1:subtask-1",
            }
          : undefined,
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
        {
          type: "question.asked",
          properties: {
            sessionID: "external-child-session",
            info: {
              parentID: "external-session-1",
            },
            id: "question-child-1",
            questions: [
              {
                header: "Scope",
                question: "Pick target",
                options: [{ label: "A", description: "Option A" }],
              },
            ],
          },
        } as unknown as Event,
      ],
      undefined,
      () => undefined,
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

  test("re-emits unresolved child question events after subagent correlation binds", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        {
          type: "question.asked",
          properties: {
            sessionID: "external-child-session",
            info: {
              parentID: "external-session-1",
            },
            id: "question-child-1",
            questions: [
              {
                header: "Scope",
                question: "Pick target",
                options: [{ label: "A", description: "Option A" }],
              },
            ],
          },
        } as unknown as Event,
        {
          type: "session.updated",
          properties: {
            info: {
              id: "external-child-session",
              parentID: "external-session-1",
              time: {
                created: Date.parse("2026-02-22T12:00:11.000Z"),
              },
            },
          },
        } as unknown as Event,
      ],
      (session) => {
        session.pendingSubagentCorrelationKeys.push("part:assistant-1:subtask-1");
      },
      () => undefined,
    );

    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(questionEvents).toHaveLength(2);
    expect(questionEvents[0]).toMatchObject({
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
    });
    expect(questionEvents[0].subagentCorrelationKey).toBeUndefined();
    expect(questionEvents[1]).toMatchObject({
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    });
  });

  test("re-emits unresolved child question events when message parts bind the child session", async () => {
    const { emitted } = await runEventStreamWithSession([
      assistantRoleEvent("assistant-subagent-question-bind"),
      makeAssistantSubtaskPartUpdatedEvent({
        messageId: "assistant-subagent-question-bind",
        partId: "subtask-a",
        agent: "build",
        prompt: "Inspect repo",
        description: "Starting A",
      }),
      {
        type: "question.asked",
        properties: {
          sessionID: "external-child-session",
          info: {
            parentID: "external-session-1",
          },
          id: "question-child-1",
          questions: [
            {
              header: "Scope",
              question: "Pick target",
              options: [{ label: "A", description: "Option A" }],
            },
          ],
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "subtask-a",
            sessionID: "external-session-1",
            messageID: "assistant-subagent-question-bind",
            type: "tool",
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
      } as unknown as Event,
    ]);

    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(questionEvents).toHaveLength(2);
    expect(questionEvents[0].subagentCorrelationKey).toBeUndefined();
    expect(questionEvents[1]).toMatchObject({
      requestId: "question-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-subagent-question-bind:subtask-a",
    });
  });

  test("subscribeOpencodeEvents forwards known child permission events to parent subscribers", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        {
          type: "permission.asked",
          properties: {
            sessionID: "external-child-session",
            id: "perm-child-1",
            permission: "read",
            patterns: ["src/**"],
          },
        } as unknown as Event,
      ],
      undefined,
      (childExternalSessionId) =>
        childExternalSessionId === "external-child-session"
          ? {
              parentExternalSessionId: "external-session-1",
              childExternalSessionId,
              subagentCorrelationKey: "part:assistant-1:subtask-1",
            }
          : undefined,
    );

    const permissionEvents = emitted.filter((event) => event.type === "permission_required");
    expect(permissionEvents).toHaveLength(1);
    expect(permissionEvents[0]).toMatchObject({
      type: "permission_required",
      externalSessionId: "external-session-1",
      requestId: "perm-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
      subagentCorrelationKey: "part:assistant-1:subtask-1",
    });
  });

  test("forwards child permission events with parent id before the child link is known", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        {
          type: "permission.asked",
          properties: {
            sessionID: "external-child-session",
            info: {
              parentID: "external-session-1",
            },
            id: "perm-child-1",
            permission: "read",
            patterns: ["src/**"],
          },
        } as unknown as Event,
      ],
      undefined,
      () => undefined,
    );

    const permissionEvents = emitted.filter((event) => event.type === "permission_required");
    expect(permissionEvents).toHaveLength(1);
    expect(permissionEvents[0]).toMatchObject({
      type: "permission_required",
      externalSessionId: "external-session-1",
      requestId: "perm-child-1",
      childExternalSessionId: "external-child-session",
      parentExternalSessionId: "external-session-1",
    });
    expect(permissionEvents[0].subagentCorrelationKey).toBeUndefined();
  });

  test("subscribeOpencodeEvents ignores child permission links for other parents", async () => {
    const { emitted } = await runEventStreamWithSession(
      [
        {
          type: "permission.asked",
          properties: {
            sessionID: "external-child-session",
            id: "perm-child-1",
            permission: "read",
            patterns: ["src/**"],
          },
        } as unknown as Event,
      ],
      undefined,
      (childExternalSessionId) =>
        childExternalSessionId === "external-child-session"
          ? {
              parentExternalSessionId: "other-external-parent",
              childExternalSessionId,
              subagentCorrelationKey: "part:assistant-1:subtask-1",
            }
          : undefined,
    );

    expect(emitted.filter((event) => event.type === "permission_required")).toHaveLength(0);
  });

  test("forwards subagent session linkage on child permission events", () => {
    const emitted: AgentEvent[] = [];
    const client = makeClientWithEvents([]);
    const sessionRecord = makeSessionRecord(client);

    processOpencodeEvent({
      context: {
        externalSessionId: "external-child-session",
        input: makeSessionInput(),
      },
      event: {
        type: "permission.asked",
        properties: {
          sessionID: "external-child-session",
          id: "perm-child-1",
          permission: "read",
          patterns: ["src/**"],
        },
      } as unknown as Event,
      now: () => "2026-02-22T12:00:00.000Z",
      emit: (_sessionId, event) => emitted.push(event),
      getSession: () => sessionRecord,
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
    if (permissionEvent?.type !== "permission_required") {
      throw new Error("Expected permission_required event");
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
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-2",
          messageID: "assistant-message-3",
          field: "text",
          delta: "stale ",
        },
      } as unknown as Event,
      {
        type: "message.part.removed",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-2",
        },
      } as unknown as Event,
      {
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
      } as unknown as Event,
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
        {
          type: "message.part.removed",
          properties: {
            sessionID: "external-session-1",
            partID: "subtask-part-1",
          },
        } as unknown as Event,
      ],
      (record) => {
        record.pendingSubagentPartEmissionsByExternalSessionId.set("child-session-1", [
          {
            part: {
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
            } as unknown as Event["properties"],
            roleHint: "assistant",
          },
        ]);
      },
    );

    expect(sessionRecord.pendingSubagentPartEmissionsByExternalSessionId.size).toBe(0);
  });

  test("normalizes unknown session error payload", async () => {
    const emitted = await runEventStream([
      {
        type: "session.error",
        properties: {
          sessionID: "external-session-1",
          error: { data: {} },
        },
      } as unknown as Event,
    ]);

    const errors = emitted.filter((event) => event.type === "session_error");
    expect(errors).toHaveLength(1);
    if (errors[0]?.type !== "session_error") {
      throw new Error("Expected session_error event");
    }
    expect(errors[0].message).toBe("Unknown session error");
  });

  test("does not replay duplicate delta after suppressed known user-part update", async () => {
    const emitted = await runEventStream([
      {
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
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          messageID: "message-dup-1",
          partID: "part-dup-1",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
      {
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
      } as unknown as Event,
    ]);

    const parts = emitted.filter((event) => event.type === "assistant_part");
    expect(parts).toHaveLength(1);
    if (parts[0]?.type !== "assistant_part" || parts[0].part.kind !== "text") {
      throw new Error("Expected assistant text part event");
    }
    expect(parts[0].part.text).toBe("hello world");
  });
});
