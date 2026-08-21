import { z } from "zod";
import { CODEX_APP_SERVER_SERVER_NOTIFICATION_METHODS } from "./codex-app-server-protocol";
import {
  codexAppServerCommandExecutionRequestApprovalParamsSchema,
  codexAppServerCurrentTimeReadParamsSchema,
  codexAppServerExecCommandApprovalParamsSchema,
  codexAppServerMcpServerElicitationRequestParamsSchema,
  codexAppServerPermissionsRequestApprovalParamsSchema,
} from "./codex-app-server-protocol-schemas";
import { jsonValueSchema, type JsonValue } from "./json-types";

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const requestIdSchema = z.union([z.string(), z.number()]);
const receivedAtSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  error: "Expected a parseable timestamp",
});
const notification = <Method extends string, Params extends z.ZodType>(
  method: Method,
  params: Params,
) => z.object({ method: z.literal(method), params: params.and(jsonObjectSchema) });
const serverRequest = <Method extends string, Params extends z.ZodType>(
  method: Method,
  params: Params,
) =>
  z.object({
    id: requestIdSchema,
    method: z.literal(method),
    params: params.and(jsonObjectSchema),
  });

const threadTurnParamsSchema = z.object({ threadId: z.string(), turn: jsonObjectSchema });
const itemDeltaParamsSchema = z.object({
  delta: z.string(),
  itemId: z.string(),
  threadId: z.string(),
  turnId: z.string(),
});
const reasoningTextDeltaParamsSchema = itemDeltaParamsSchema.extend({
  contentIndex: z.number(),
});
const reasoningSummaryDeltaParamsSchema = itemDeltaParamsSchema.extend({
  summaryIndex: z.number(),
});
const itemLifecycleParamsSchema = z.object({
  item: jsonObjectSchema,
  threadId: z.string(),
  turnId: z.string(),
  startedAtMs: z.number().optional(),
});

const toolRequestUserInputParamsSchema = z.object({
  autoResolutionMs: z.number().nullable(),
  isBlocking: z.boolean(),
  itemId: z.string(),
  questions: z.array(jsonObjectSchema),
  threadId: z.string(),
  turnId: z.string(),
});
export const codexAppServerConsumedRuntimeNotificationSchema = z.discriminatedUnion("method", [
  notification("skills/changed", z.object({}).strict()),
  notification(
    "serverRequest/resolved",
    z.object({ requestId: requestIdSchema, threadId: z.string() }),
  ),
  notification(
    "thread/tokenUsage/updated",
    z.object({ threadId: z.string(), tokenUsage: jsonObjectSchema, turnId: z.string() }),
  ),
  notification("turn/started", threadTurnParamsSchema),
  notification("turn/completed", threadTurnParamsSchema),
  notification(
    "thread/status/changed",
    z.object({ status: jsonValueSchema, threadId: z.string() }),
  ),
  notification(
    "model/safetyBuffering/updated",
    z.object({
      fasterModel: z.string().nullable(),
      model: z.string(),
      reasons: z.array(z.string()),
      showBufferingUi: z.boolean(),
      threadId: z.string(),
      turnId: z.string(),
      useCases: z.array(z.string()),
    }),
  ),
  notification(
    "turn/plan/updated",
    z.object({
      explanation: z.string().nullable(),
      plan: z.array(jsonObjectSchema),
      threadId: z.string(),
      turnId: z.string(),
    }),
  ),
  notification(
    "turn/diff/updated",
    z.object({ diff: z.string(), threadId: z.string(), turnId: z.string() }),
  ),
  notification("item/agentMessage/delta", itemDeltaParamsSchema),
  notification("item/reasoning/textDelta", reasoningTextDeltaParamsSchema),
  notification("item/reasoningText/delta", reasoningTextDeltaParamsSchema),
  notification("item/reasoning/summaryTextDelta", reasoningSummaryDeltaParamsSchema),
  notification("item/reasoningSummaryText/delta", reasoningSummaryDeltaParamsSchema),
  notification("item/started", itemLifecycleParamsSchema),
  notification(
    "item/completed",
    itemLifecycleParamsSchema
      .omit({ startedAtMs: true })
      .extend({ completedAtMs: z.number().optional() }),
  ),
  notification(
    "item/fileChange/patchUpdated",
    z.object({
      changes: z.array(jsonObjectSchema),
      itemId: z.string(),
      threadId: z.string(),
      turnId: z.string(),
    }),
  ),
]);

const codexAppServerUnconsumedNotificationMethodSchema = z
  .enum(CODEX_APP_SERVER_SERVER_NOTIFICATION_METHODS)
  .exclude([
    "skills/changed",
    "serverRequest/resolved",
    "thread/tokenUsage/updated",
    "turn/started",
    "turn/completed",
    "thread/status/changed",
    "model/safetyBuffering/updated",
    "turn/plan/updated",
    "turn/diff/updated",
    "item/agentMessage/delta",
    "item/reasoning/textDelta",
    "item/reasoning/summaryTextDelta",
    "item/started",
    "item/completed",
    "item/fileChange/patchUpdated",
  ]);

export const codexAppServerUnconsumedRuntimeNotificationSchema = z.object({
  method: codexAppServerUnconsumedNotificationMethodSchema,
  params: jsonValueSchema,
});

export const codexAppServerRuntimeNotificationSchema = z.union([
  codexAppServerConsumedRuntimeNotificationSchema,
  codexAppServerUnconsumedRuntimeNotificationSchema,
]);

export const codexAppServerServerRequestSchema = z.discriminatedUnion("method", [
  serverRequest("execCommandApproval", codexAppServerExecCommandApprovalParamsSchema),
  serverRequest(
    "applyPatchApproval",
    z.object({
      callId: z.string(),
      conversationId: z.string(),
      fileChanges: jsonObjectSchema,
      grantRoot: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  serverRequest(
    "item/commandExecution/requestApproval",
    codexAppServerCommandExecutionRequestApprovalParamsSchema,
  ),
  serverRequest(
    "item/fileChange/requestApproval",
    z.object({
      grantRoot: z.string().nullable().optional(),
      itemId: z.string(),
      reason: z.string().nullable().optional(),
      startedAtMs: z.number(),
      threadId: z.string(),
      turnId: z.string(),
    }),
  ),
  serverRequest(
    "item/permissions/requestApproval",
    codexAppServerPermissionsRequestApprovalParamsSchema,
  ),
  serverRequest("item/tool/requestUserInput", toolRequestUserInputParamsSchema),
  serverRequest(
    "mcpServer/elicitation/request",
    codexAppServerMcpServerElicitationRequestParamsSchema,
  ),
  serverRequest(
    "item/tool/call",
    z.object({
      arguments: jsonValueSchema,
      callId: z.string(),
      namespace: z.string().nullable(),
      threadId: z.string(),
      tool: z.string(),
      turnId: z.string(),
    }),
  ),
  serverRequest(
    "account/chatgptAuthTokens/refresh",
    z.object({
      reason: z.literal("unauthorized"),
      previousAccountId: z.string().nullable().optional(),
    }),
  ),
  serverRequest("attestation/generate", z.object({}).strict()),
  serverRequest("currentTime/read", codexAppServerCurrentTimeReadParamsSchema),
]);

const codexAppServerLegacyApprovalRequestSchema = serverRequest(
  "approval/request",
  z.object({
    threadId: z.string().optional(),
    turnId: z.string().optional(),
    tool: z.string().optional(),
    url: z.string().optional(),
  }),
);

export const codexAppServerRuntimeServerRequestSchema = z.union([
  codexAppServerServerRequestSchema,
  codexAppServerLegacyApprovalRequestSchema,
]);

export const codexAppServerServerNotificationSchema = z.object({
  method: z.string().trim().min(1),
  params: jsonValueSchema,
});

export const codexAppServerRuntimeStreamEventSchema = z.discriminatedUnion("kind", [
  z.object({
    runtimeId: z.string(),
    kind: z.literal("notification"),
    receivedAt: receivedAtSchema,
    message: codexAppServerRuntimeNotificationSchema,
  }),
  z.object({
    runtimeId: z.string(),
    kind: z.literal("server_request"),
    receivedAt: receivedAtSchema,
    message: codexAppServerRuntimeServerRequestSchema,
  }),
]);

export const codexAppServerRuntimeNotificationRecordSchema = z.object({
  method: z.string().trim().min(1),
  params: jsonObjectSchema.optional(),
  receivedAt: receivedAtSchema,
});
const codexAppServerRuntimeNotificationPayloadSchema =
  codexAppServerRuntimeNotificationRecordSchema.partial({ receivedAt: true });

export const codexAppServerRuntimeServerRequestRecordSchema = z.object({
  id: requestIdSchema.optional(),
  method: z.string().trim().min(1),
  params: jsonObjectSchema.optional(),
});

export type CodexAppServerRuntimeNotification = z.infer<
  typeof codexAppServerRuntimeNotificationSchema
>;
export type CodexAppServerConsumedRuntimeNotification = z.infer<
  typeof codexAppServerConsumedRuntimeNotificationSchema
>;
export type CodexAppServerUnconsumedRuntimeNotification = z.infer<
  typeof codexAppServerUnconsumedRuntimeNotificationSchema
>;
export type CodexAppServerRuntimeServerRequest = z.infer<
  typeof codexAppServerRuntimeServerRequestSchema
>;
export type CodexAppServerWireServerRequest = z.infer<typeof codexAppServerServerRequestSchema>;
export type CodexAppServerRuntimeStreamEvent = z.infer<
  typeof codexAppServerRuntimeStreamEventSchema
>;
export type CodexAppServerRuntimeNotificationRecord = z.infer<
  typeof codexAppServerRuntimeNotificationRecordSchema
>;
export type CodexAppServerRuntimeServerRequestRecord = z.infer<
  typeof codexAppServerRuntimeServerRequestRecordSchema
>;

export const parseCodexAppServerRuntimeStreamEvent = (value: JsonValue) =>
  codexAppServerRuntimeStreamEventSchema.parse(value);

export const parseCodexAppServerRuntimeNotificationRecord = (
  value: JsonValue,
  receivedAt?: string,
) => {
  const notification = codexAppServerRuntimeNotificationPayloadSchema.parse(value);
  return codexAppServerRuntimeNotificationRecordSchema.parse({
    ...notification,
    receivedAt: receivedAt === undefined ? notification.receivedAt : receivedAt,
  });
};

export const parseCodexAppServerRuntimeServerRequestRecord = (value: JsonValue) =>
  codexAppServerRuntimeServerRequestRecordSchema.parse(value);
