import { z, type JSONType } from "zod";
import { codexInt64Schema, codexUint64Schema } from "./codex-app-server-number-schemas";
import {
  codexAppServerCommandExecutionRequestApprovalParamsSchema,
  codexAppServerCurrentTimeReadParamsSchema,
  codexAppServerExecCommandApprovalParamsSchema,
  codexAppServerMcpServerElicitationRequestParamsSchema,
  codexAppServerPermissionsRequestApprovalParamsSchema,
} from "./codex-app-server-permission-schemas";
import {
  codexAppServerThreadItemSchema,
  codexAppServerThreadStatusSchema,
  codexAppServerTurnSchema,
} from "./codex-app-server-thread-schemas";
const codexAppServerJsonValueSchema = z.json();
const codexAppServerJsonObjectSchema = z.record(z.string(), codexAppServerJsonValueSchema);
const nonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, { error: "String must not be blank" });
const requestIdSchema = z.union([z.string(), codexInt64Schema]);
const receivedAtSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  error: "Expected a parseable timestamp",
});
const notification = <Method extends string, Params extends z.ZodType>(
  method: Method,
  params: Params,
) => z.object({ method: z.literal(method), params: params.and(codexAppServerJsonObjectSchema) });
const serverRequest = <Method extends string, Params extends z.ZodType>(
  method: Method,
  params: Params,
) =>
  z.object({
    id: requestIdSchema,
    method: z.literal(method),
    params: params.and(codexAppServerJsonObjectSchema),
  });

const threadTurnParamsSchema = z.object({ threadId: z.string(), turn: codexAppServerTurnSchema });
const tokenUsageBreakdownSchema = z.object({
  totalTokens: codexInt64Schema,
  inputTokens: codexInt64Schema,
  cachedInputTokens: codexInt64Schema,
  cacheWriteInputTokens: codexInt64Schema,
  outputTokens: codexInt64Schema,
  reasoningOutputTokens: codexInt64Schema,
});
const threadTokenUsageSchema = z.object({
  total: tokenUsageBreakdownSchema,
  last: tokenUsageBreakdownSchema,
  modelContextWindow: codexInt64Schema.nullable(),
});
const turnPlanStepSchema = z.object({
  step: z.string(),
  status: z.enum(["pending", "inProgress", "completed"]),
});
const fileUpdateChangeSchema = z.object({
  path: z.string(),
  kind: z.discriminatedUnion("type", [
    z.object({ type: z.literal("add") }),
    z.object({ type: z.literal("delete") }),
    z.object({ type: z.literal("update"), move_path: z.string().nullable() }),
  ]),
  diff: z.string(),
});
const legacyFileChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), content: z.string() }),
  z.object({ type: z.literal("delete"), content: z.string() }),
  z.object({
    type: z.literal("update"),
    unified_diff: z.string(),
    move_path: z.string().nullable(),
  }),
]);
const itemDeltaParamsSchema = z.object({
  delta: z.string(),
  itemId: z.string(),
  threadId: z.string(),
  turnId: z.string(),
});
const reasoningTextDeltaParamsSchema = itemDeltaParamsSchema.extend({
  contentIndex: codexInt64Schema,
});
const reasoningSummaryDeltaParamsSchema = itemDeltaParamsSchema.extend({
  summaryIndex: codexInt64Schema,
});
const itemLifecycleParamsSchema = z.object({
  item: codexAppServerThreadItemSchema,
  threadId: z.string(),
  turnId: z.string(),
  startedAtMs: codexInt64Schema,
});

const toolRequestUserInputOptionSchema = z.object({
  description: z.string(),
  label: z.string(),
});
const toolRequestUserInputQuestionSchema = z.object({
  header: z.string(),
  id: z.string(),
  isOther: z.boolean(),
  isSecret: z.boolean(),
  options: z.array(toolRequestUserInputOptionSchema).nullable(),
  question: z.string(),
});
const toolRequestUserInputParamsSchema = z.object({
  autoResolutionMs: codexUint64Schema.nullable(),
  isBlocking: z.boolean(),
  itemId: z.string(),
  questions: z.array(toolRequestUserInputQuestionSchema),
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
    z.object({ threadId: z.string(), tokenUsage: threadTokenUsageSchema, turnId: z.string() }),
  ),
  notification("turn/started", threadTurnParamsSchema),
  notification("turn/completed", threadTurnParamsSchema),
  notification(
    "thread/status/changed",
    z.object({ status: codexAppServerThreadStatusSchema, threadId: z.string() }),
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
      plan: z.array(turnPlanStepSchema),
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
  notification("item/reasoning/summaryTextDelta", reasoningSummaryDeltaParamsSchema),
  notification("item/started", itemLifecycleParamsSchema),
  notification(
    "item/completed",
    itemLifecycleParamsSchema
      .omit({ startedAtMs: true })
      .extend({ completedAtMs: codexInt64Schema }),
  ),
  notification(
    "item/fileChange/patchUpdated",
    z.object({
      changes: z.array(fileUpdateChangeSchema),
      itemId: z.string(),
      threadId: z.string(),
      turnId: z.string(),
    }),
  ),
]);

const consumedRuntimeNotificationMethods = new Set([
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

const codexAppServerUnconsumedNotificationMethodSchema = z
  .string()
  .refine((method) => method.trim().length > 0, { error: "Method must not be blank" })
  .refine((method) => !consumedRuntimeNotificationMethods.has(method), {
    error: "Consumed runtime notifications must match their declared parameter schema",
  });

export const codexAppServerUnconsumedRuntimeNotificationSchema = z.object({
  method: codexAppServerUnconsumedNotificationMethodSchema,
  params: codexAppServerJsonValueSchema,
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
      fileChanges: z.record(z.string(), legacyFileChangeSchema),
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
      startedAtMs: codexInt64Schema,
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
      arguments: codexAppServerJsonValueSchema,
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

export const codexAppServerRuntimeServerRequestSchema = codexAppServerServerRequestSchema;

export const codexAppServerServerNotificationSchema = z.object({
  method: nonBlankStringSchema,
  params: codexAppServerJsonValueSchema,
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
  method: nonBlankStringSchema,
  params: codexAppServerJsonObjectSchema.optional(),
  receivedAt: receivedAtSchema,
});
const codexAppServerRuntimeNotificationPayloadSchema =
  codexAppServerRuntimeNotificationRecordSchema.partial({ receivedAt: true });

export const codexAppServerRuntimeServerRequestRecordSchema = z.object({
  id: requestIdSchema.optional(),
  method: nonBlankStringSchema,
  params: codexAppServerJsonObjectSchema.optional(),
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

export const isCodexAppServerConsumedRuntimeNotification = (
  notification: CodexAppServerRuntimeNotification,
): notification is CodexAppServerConsumedRuntimeNotification =>
  consumedRuntimeNotificationMethods.has(notification.method);

export const parseCodexAppServerRuntimeStreamEvent = (value: JSONType) =>
  codexAppServerRuntimeStreamEventSchema.parse(value);

export const parseCodexAppServerRuntimeNotificationRecord = (
  value: JSONType,
  receivedAt?: string,
) => {
  const notification = codexAppServerRuntimeNotificationPayloadSchema.parse(value);
  return codexAppServerRuntimeNotificationRecordSchema.parse({
    ...notification,
    receivedAt: receivedAt === undefined ? notification.receivedAt : receivedAt,
  });
};

export const parseCodexAppServerRuntimeServerRequestRecord = (value: JSONType) =>
  codexAppServerRuntimeServerRequestRecordSchema.parse(value);
