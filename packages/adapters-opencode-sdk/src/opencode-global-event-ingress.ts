import type { GlobalEvent } from "@opencode-ai/sdk/v2/client";
import { z } from "zod";
import { opencodeProtocolObjectSchema } from "./guards";
import {
  opencodeMessageErrorSchema,
  opencodeMessageInfoPayloadSchema,
  opencodePartPayloadSchema,
  opencodeSessionDetailPayloadSchema,
} from "./opencode-ingress";
import { isConsumedOpencodeEventType, isKnownOpencodeEventType } from "./opencode-event-policy";

const eventSchema = <Type extends string, Properties extends z.ZodType>(
  type: Type,
  properties: Properties,
) =>
  z.object({
    id: z.string(),
    type: z.literal(type),
    properties: z.intersection(properties, z.object({ directory: z.string().optional() })),
  });

const messageUpdatedEventSchema = eventSchema(
  "message.updated",
  z.object({ sessionID: z.string(), info: opencodeMessageInfoPayloadSchema }),
);
const messageRemovedEventSchema = eventSchema(
  "message.removed",
  z.object({ sessionID: z.string(), messageID: z.string() }),
);
const messagePartUpdatedEventSchema = eventSchema(
  "message.part.updated",
  z.object({
    sessionID: z.string(),
    part: opencodePartPayloadSchema,
    time: z.number(),
  }),
);
const messagePartRemovedEventSchema = eventSchema(
  "message.part.removed",
  z.object({ sessionID: z.string(), messageID: z.string(), partID: z.string() }),
);
const messagePartDeltaEventSchema = eventSchema(
  "message.part.delta",
  z.object({
    sessionID: z.string(),
    messageID: z.string(),
    partID: z.string(),
    field: z.string(),
    delta: z.string(),
  }),
);

const sessionEventSchema = <Type extends "session.created" | "session.updated" | "session.deleted">(
  type: Type,
) =>
  eventSchema(type, z.object({ sessionID: z.string(), info: opencodeSessionDetailPayloadSchema }));
const sessionCreatedEventSchema = sessionEventSchema("session.created");
const sessionUpdatedEventSchema = sessionEventSchema("session.updated");
const sessionDeletedEventSchema = sessionEventSchema("session.deleted");
const sessionErrorEventSchema = eventSchema(
  "session.error",
  z.object({ sessionID: z.string().optional(), error: opencodeMessageErrorSchema.optional() }),
);
const sessionIdleEventSchema = eventSchema("session.idle", z.object({ sessionID: z.string() }));
const sessionCompactedEventSchema = eventSchema(
  "session.compacted",
  z.object({ sessionID: z.string() }),
);

const permissionV2SourceSchema = z.object({
  type: z.literal("tool"),
  messageID: z.string(),
  callID: z.string(),
});
export const opencodePermissionV2AskedEventSchema = eventSchema(
  "permission.v2.asked",
  z.object({
    id: z.string(),
    sessionID: z.string(),
    action: z.string(),
    resources: z.array(z.string()),
    save: z.array(z.string()).optional(),
    metadata: opencodeProtocolObjectSchema.optional(),
    source: permissionV2SourceSchema.optional(),
  }),
);
export const opencodePermissionAskedEventSchema = eventSchema(
  "permission.asked",
  z.object({
    id: z.string(),
    sessionID: z.string(),
    permission: z.string(),
    patterns: z.array(z.string()),
    metadata: opencodeProtocolObjectSchema,
    always: z.array(z.string()),
    tool: z.object({ messageID: z.string(), callID: z.string() }).optional(),
  }),
);

const permissionRepliedEventSchema = <Type extends "permission.replied" | "permission.v2.replied">(
  type: Type,
) =>
  eventSchema(
    type,
    z.object({
      sessionID: z.string(),
      requestID: z.string(),
      reply: z.enum(["once", "always", "reject"]),
    }),
  );
export const opencodePermissionV2RepliedEventSchema =
  permissionRepliedEventSchema("permission.v2.replied");
export const opencodePermissionRepliedEventSchema =
  permissionRepliedEventSchema("permission.replied");

const questionOptionSchema = z.object({ label: z.string(), description: z.string() });
const questionSchema = z.object({
  header: z.string(),
  question: z.string(),
  options: z.array(questionOptionSchema),
  multiple: z.boolean().optional(),
  custom: z.boolean().optional(),
});
const questionAskedEventSchema = <Type extends "question.asked" | "question.v2.asked">(
  type: Type,
) =>
  eventSchema(
    type,
    z.object({
      id: z.string(),
      sessionID: z.string(),
      questions: z.array(questionSchema),
      tool: z.object({ messageID: z.string(), callID: z.string() }).optional(),
    }),
  );
export const opencodeQuestionV2AskedEventSchema = questionAskedEventSchema("question.v2.asked");
export const opencodeQuestionAskedEventSchema = questionAskedEventSchema("question.asked");
export type ParsedOpencodeQuestionAskedProperties = z.output<
  typeof opencodeQuestionAskedEventSchema
>["properties"];

const questionRepliedEventSchema = <Type extends "question.replied" | "question.v2.replied">(
  type: Type,
) =>
  eventSchema(
    type,
    z.object({
      sessionID: z.string(),
      requestID: z.string(),
      answers: z.array(z.array(z.string())),
    }),
  );
export const opencodeQuestionV2RepliedEventSchema =
  questionRepliedEventSchema("question.v2.replied");
export const opencodeQuestionRepliedEventSchema = questionRepliedEventSchema("question.replied");

const questionRejectedEventSchema = <Type extends "question.rejected" | "question.v2.rejected">(
  type: Type,
) => eventSchema(type, z.object({ sessionID: z.string(), requestID: z.string() }));
export const opencodeQuestionV2RejectedEventSchema =
  questionRejectedEventSchema("question.v2.rejected");
export const opencodeQuestionRejectedEventSchema = questionRejectedEventSchema("question.rejected");

const sessionStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("idle") }),
  z.object({
    type: z.literal("retry"),
    attempt: z.number().int().nonnegative(),
    message: z.string(),
    action: z
      .object({
        reason: z.string(),
        provider: z.string(),
        title: z.string(),
        message: z.string(),
        label: z.string(),
        link: z.string().optional(),
      })
      .optional(),
    next: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("busy") }),
]);
export const opencodeSessionStatusEventSchema = eventSchema(
  "session.status",
  z.object({ sessionID: z.string(), status: sessionStatusSchema }),
);

const todoUpdatedEventSchema = eventSchema(
  "todo.updated",
  z.object({
    sessionID: z.string(),
    todos: z.array(z.object({ content: z.string(), status: z.string(), priority: z.string() })),
  }),
);

const ignoredDirectEventSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    properties: z.unknown(),
  })
  .refine(({ type }) => isKnownOpencodeEventType(type) && !isConsumedOpencodeEventType(type), {
    message: "OpenCode events must have an explicit ingress policy.",
    path: ["type"],
  })
  .transform(({ id, type }) => ({ kind: "ignored" as const, id, type }));

export const opencodeDirectEventSchema = z.union([
  sessionCreatedEventSchema,
  sessionUpdatedEventSchema,
  sessionDeletedEventSchema,
  messageUpdatedEventSchema,
  messageRemovedEventSchema,
  messagePartUpdatedEventSchema,
  messagePartRemovedEventSchema,
  messagePartDeltaEventSchema,
  sessionErrorEventSchema,
  opencodePermissionV2AskedEventSchema,
  opencodePermissionV2RepliedEventSchema,
  opencodeQuestionV2AskedEventSchema,
  opencodeQuestionV2RepliedEventSchema,
  opencodeQuestionV2RejectedEventSchema,
  todoUpdatedEventSchema,
  opencodePermissionAskedEventSchema,
  opencodePermissionRepliedEventSchema,
  opencodeSessionStatusEventSchema,
  sessionIdleEventSchema,
  opencodeQuestionAskedEventSchema,
  opencodeQuestionRepliedEventSchema,
  opencodeQuestionRejectedEventSchema,
  sessionCompactedEventSchema,
]);

const opencodeIngressEventSchema = z.union([opencodeDirectEventSchema, ignoredDirectEventSchema]);

const syncEventSchema = z.object({
  aggregateID: z.string(),
  data: z.looseObject({}),
  id: z.string(),
  seq: z.number(),
  type: z.string(),
});
const syncEnvelopeSchema = z.object({
  id: z.string(),
  type: z.literal("sync"),
  syncEvent: syncEventSchema,
});
const serverHeartbeatSchema = eventSchema("server.heartbeat", z.object({}).strict());
const ingressEventDescriptorSchema = z.object({
  type: z.string(),
  syncEvent: z.object({ type: z.string() }).optional(),
});

export const opencodeGlobalEventPayloadSchema = z.union([
  opencodeIngressEventSchema,
  syncEnvelopeSchema,
  serverHeartbeatSchema,
]);

export type OpencodeGlobalEventPayload =
  | GlobalEvent["payload"]
  | z.output<typeof serverHeartbeatSchema>;
export type ParsedOpencodeEvent = z.output<typeof opencodeDirectEventSchema>;
export type ParsedOpencodeIngressEvent = z.output<typeof opencodeIngressEventSchema>;
export type ParsedOpencodeGlobalEventPayload = z.output<typeof opencodeGlobalEventPayloadSchema>;
export type OpencodeGlobalEventPayloadInput =
  | GlobalEvent["payload"]
  | ParsedOpencodeGlobalEventPayload
  | z.input<typeof opencodeGlobalEventPayloadSchema>;

const formatIngressIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "payload"}: ${issue.message}`)
    .join("; ");

type IngressEventDescriptor = z.output<typeof ingressEventDescriptorSchema>;

const describeIngressEvent = (event: IngressEventDescriptor | null): string => {
  if (!event) {
    return "unknown event";
  }
  if (event.type !== "sync") {
    return event.type;
  }
  return event.syncEvent ? `sync ${event.syncEvent.type}` : "sync";
};

export const parseOpencodeGlobalEventPayload = (
  value: OpencodeGlobalEventPayloadInput,
): ParsedOpencodeGlobalEventPayload => {
  const parsed = opencodeGlobalEventPayloadSchema.safeParse(value);
  if (!parsed.success) {
    const descriptor = ingressEventDescriptorSchema.safeParse(value);
    throw new Error(
      `Invalid OpenCode global event payload (${describeIngressEvent(descriptor.success ? descriptor.data : null)}): ${formatIngressIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

export const parseOpencodeDirectEvent = (
  value: ParsedOpencodeEvent | z.input<typeof opencodeDirectEventSchema>,
): ParsedOpencodeEvent => {
  const parsed = opencodeDirectEventSchema.safeParse(value);
  if (!parsed.success) {
    const descriptor = ingressEventDescriptorSchema.safeParse(value);
    throw new Error(
      `Invalid OpenCode event (${describeIngressEvent(descriptor.success ? descriptor.data : null)}): ${formatIngressIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

export const parseOpencodeIngressEvent = (
  value: ParsedOpencodeIngressEvent | z.input<typeof opencodeIngressEventSchema>,
): ParsedOpencodeIngressEvent => {
  const parsed = opencodeIngressEventSchema.safeParse(value);
  if (!parsed.success) {
    const descriptor = ingressEventDescriptorSchema.safeParse(value);
    throw new Error(
      `Invalid OpenCode event (${describeIngressEvent(descriptor.success ? descriptor.data : null)}): ${formatIngressIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};
