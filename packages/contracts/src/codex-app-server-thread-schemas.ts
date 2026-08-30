import { z } from "zod";
import {
  codexInt32Schema,
  codexInt64Schema,
  codexUint16Schema,
  codexUint32Schema,
  codexUint64Schema,
} from "./codex-app-server-number-schemas";
import { codexAppServerCommandActionSchema } from "./codex-app-server-permission-schemas";
import {
  codexAppServerReasoningEffortSchema,
  codexAppServerUserInputSchema,
} from "./codex-app-server-request-schemas";
import { jsonValueSchema } from "./json-types";

export const codexAppServerThreadStatusSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("active"),
    activeFlags: z.array(z.enum(["waitingOnApproval", "waitingOnUserInput"])),
  }),
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("notLoaded") }),
  z.object({ type: z.literal("systemError") }),
]);

export type CodexAppServerThreadStatus = z.output<typeof codexAppServerThreadStatusSchema>;

const codexAppServerSubAgentSourceSchema = z.union([
  z.enum(["review", "compact", "memory_consolidation"]),
  z.object({ other: z.string() }),
  z.object({
    thread_spawn: z.object({
      parent_thread_id: z.string(),
      depth: codexInt32Schema,
      agent_path: z.string().nullable(),
      agent_nickname: z.string().nullable(),
      agent_role: z.string().nullable(),
    }),
  }),
]);

const codexAppServerSessionSourceSchema = z.union([
  z.enum(["appServer", "cli", "exec", "unknown", "vscode"]),
  z.object({ custom: z.string() }),
  z.object({ subAgent: codexAppServerSubAgentSourceSchema }),
]);

const codexAppServerThreadSectionAppearanceSchema = z.object({
  icon: z.string().nullable(),
  color: z.string().nullable(),
});

const codexAppServerThreadSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  appearance: codexAppServerThreadSectionAppearanceSchema.nullable(),
});

const codexAppServerGitInfoSchema = z.object({
  sha: z.string().nullable(),
  branch: z.string().nullable(),
  originUrl: z.string().nullable(),
});

const codexAppServerMemoryCitationSchema = z.object({
  entries: z.array(
    z.object({
      path: z.string(),
      lineStart: codexUint32Schema,
      lineEnd: codexUint32Schema,
      note: z.string(),
    }),
  ),
  threadIds: z.array(z.string()),
});

const codexAppServerFileUpdateChangeSchema = z.object({
  path: z.string(),
  kind: z.discriminatedUnion("type", [
    z.object({ type: z.literal("add") }),
    z.object({ type: z.literal("delete") }),
    z.object({ type: z.literal("update"), move_path: z.string().nullable() }),
  ]),
  diff: z.string(),
});

const codexAppServerDynamicToolCallOutputContentItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("inputText"), text: z.string() }),
  z.object({ type: z.literal("inputImage"), imageUrl: z.string() }),
  z.object({ type: z.literal("inputAudio"), audioUrl: z.string() }),
]);

const codexAppServerWebSearchActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("search"),
    query: z.string().nullable(),
    queries: z.array(z.string()).nullable(),
  }),
  z.object({ type: z.literal("openPage"), url: z.string().nullable() }),
  z.object({
    type: z.literal("findInPage"),
    url: z.string().nullable(),
    pattern: z.string().nullable(),
  }),
  z.object({ type: z.literal("other") }),
]);

const codexAppServerCollabAgentStateSchema = z.object({
  status: z.enum([
    "pendingInit",
    "running",
    "interrupted",
    "completed",
    "errored",
    "shutdown",
    "notFound",
  ]),
  message: z.string().nullable(),
});

export const codexAppServerThreadItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("userMessage"),
    id: z.string(),
    clientId: z.string().nullable(),
    content: z.array(codexAppServerUserInputSchema),
  }),
  z.object({
    type: z.literal("hookPrompt"),
    id: z.string(),
    fragments: z.array(z.object({ text: z.string(), hookRunId: z.string() })),
  }),
  z.object({
    type: z.literal("agentMessage"),
    id: z.string(),
    text: z.string(),
    phase: z.enum(["commentary", "final_answer"]).nullable(),
    memoryCitation: codexAppServerMemoryCitationSchema.nullable(),
  }),
  z.object({ type: z.literal("plan"), id: z.string(), text: z.string() }),
  z.object({
    type: z.literal("reasoning"),
    id: z.string(),
    summary: z.array(z.string()),
    content: z.array(z.string()),
  }),
  z.object({
    type: z.literal("commandExecution"),
    id: z.string(),
    pluginId: z.string().nullable(),
    scriptPath: z.string().nullable(),
    command: z.string(),
    cwd: z.string(),
    processId: z.string().nullable(),
    source: z.enum(["agent", "userShell", "unifiedExecStartup", "unifiedExecInteraction"]),
    status: z.enum(["inProgress", "completed", "failed", "declined"]),
    commandActions: z.array(codexAppServerCommandActionSchema),
    aggregatedOutput: z.string().nullable(),
    exitCode: codexInt32Schema.nullable(),
    durationMs: codexInt64Schema.nullable(),
  }),
  z.object({
    type: z.literal("fileChange"),
    id: z.string(),
    changes: z.array(codexAppServerFileUpdateChangeSchema),
    status: z.enum(["inProgress", "completed", "failed", "declined"]),
  }),
  z.object({
    type: z.literal("mcpToolCall"),
    id: z.string(),
    server: z.string(),
    tool: z.string(),
    status: z.enum(["inProgress", "completed", "failed"]),
    arguments: jsonValueSchema,
    appContext: z
      .object({
        connectorId: z.string(),
        linkId: z.string().nullable(),
        resourceUri: z.string().nullable(),
        appName: z.string().nullable(),
        actionName: z.string().nullable(),
      })
      .nullable(),
    mcpAppResourceUri: z.string().optional(),
    pluginId: z.string().nullable(),
    readOnlyHint: z.boolean().nullable(),
    result: z
      .object({
        content: z.array(jsonValueSchema),
        structuredContent: jsonValueSchema.nullable(),
        _meta: jsonValueSchema.nullable(),
      })
      .nullable(),
    error: z.object({ message: z.string() }).nullable(),
    durationMs: codexInt64Schema.nullable(),
  }),
  z.object({
    type: z.literal("dynamicToolCall"),
    id: z.string(),
    namespace: z.string().nullable(),
    tool: z.string(),
    arguments: jsonValueSchema,
    status: z.enum(["inProgress", "completed", "failed"]),
    contentItems: z.array(codexAppServerDynamicToolCallOutputContentItemSchema).nullable(),
    success: z.boolean().nullable(),
    durationMs: codexInt64Schema.nullable(),
  }),
  z.object({
    type: z.literal("collabAgentToolCall"),
    id: z.string(),
    tool: z.enum(["spawnAgent", "sendInput", "resumeAgent", "wait", "closeAgent"]),
    status: z.enum(["inProgress", "completed", "failed"]),
    senderThreadId: z.string(),
    receiverThreadIds: z.array(z.string()),
    prompt: z.string().nullable(),
    model: z.string().nullable(),
    reasoningEffort: codexAppServerReasoningEffortSchema.nullable(),
    agentsStates: z.record(z.string(), codexAppServerCollabAgentStateSchema),
  }),
  z.object({
    type: z.literal("subAgentActivity"),
    id: z.string(),
    kind: z.enum(["started", "interacted", "interrupted"]),
    agentThreadId: z.string(),
    agentPath: z.string(),
  }),
  z.object({
    type: z.literal("webSearch"),
    id: z.string(),
    query: z.string(),
    action: codexAppServerWebSearchActionSchema.nullable(),
    results: z.array(jsonValueSchema).nullable(),
  }),
  z.object({ type: z.literal("imageView"), id: z.string(), path: z.string() }),
  z.object({
    type: z.literal("sleep"),
    id: z.string(),
    durationMs: codexUint64Schema,
  }),
  z.object({
    type: z.literal("imageGeneration"),
    id: z.string(),
    status: z.string(),
    revisedPrompt: z.string().nullable(),
    result: z.string(),
    transparentBackground: z.boolean().optional(),
    failure: z
      .object({
        type: z.literal("usageLimitExceeded"),
        limitId: z.string(),
        resetsAt: codexInt64Schema.nullable(),
      })
      .nullable(),
    savedPath: z.string().optional(),
  }),
  z.object({ type: z.literal("enteredReviewMode"), id: z.string(), review: z.string() }),
  z.object({ type: z.literal("exitedReviewMode"), id: z.string(), review: z.string() }),
  z.object({ type: z.literal("contextCompaction"), id: z.string() }),
]);

export type CodexAppServerThreadItem = z.output<typeof codexAppServerThreadItemSchema>;

const codexAppServerCodexErrorInfoSchema = z.union([
  z.enum([
    "contextWindowExceeded",
    "sessionBudgetExceeded",
    "usageLimitExceeded",
    "serverOverloaded",
    "cyberPolicy",
    "misalignmentPolicyViolation",
    "internalServerError",
    "unauthorized",
    "badRequest",
    "threadRollbackFailed",
    "sandboxError",
    "other",
  ]),
  z.object({
    httpConnectionFailed: z.object({ httpStatusCode: codexUint16Schema.nullable() }),
  }),
  z.object({
    responseStreamConnectionFailed: z.object({ httpStatusCode: codexUint16Schema.nullable() }),
  }),
  z.object({
    responseStreamDisconnected: z.object({ httpStatusCode: codexUint16Schema.nullable() }),
  }),
  z.object({
    responseTooManyFailedAttempts: z.object({ httpStatusCode: codexUint16Schema.nullable() }),
  }),
  z.object({ activeTurnNotSteerable: z.object({ turnKind: z.enum(["review", "compact"]) }) }),
]);

export type CodexAppServerCodexErrorInfo = z.output<typeof codexAppServerCodexErrorInfoSchema>;

const codexAppServerTurnErrorSchema = z.object({
  message: z.string(),
  codexErrorInfo: codexAppServerCodexErrorInfoSchema.nullable(),
  additionalDetails: z.string().nullable(),
});

export type CodexAppServerTurnError = z.output<typeof codexAppServerTurnErrorSchema>;

export const codexAppServerTurnSchema = z.object({
  completedAt: codexInt64Schema.nullable(),
  durationMs: codexInt64Schema.nullable(),
  error: codexAppServerTurnErrorSchema.nullable(),
  id: z.string(),
  items: z.array(codexAppServerThreadItemSchema),
  itemsView: z.enum(["full", "notLoaded", "summary"]),
  startedAt: codexInt64Schema.nullable(),
  status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
});

export type CodexAppServerTurn = z.output<typeof codexAppServerTurnSchema>;

export const codexAppServerThreadSchema = z.object({
  id: z.string(),
  extra: z.object({}).strict().nullable(),
  sessionId: z.string(),
  forkedFromId: z.string().nullable(),
  parentThreadId: z.string().nullable(),
  preview: z.string(),
  ephemeral: z.boolean(),
  section: codexAppServerThreadSectionSchema.nullable(),
  sectionEnteredAt: codexInt64Schema.nullable(),
  projectId: z.string().nullable(),
  historyMode: z.enum(["legacy", "paginated"]),
  modelProvider: z.string(),
  createdAt: codexInt64Schema,
  updatedAt: codexInt64Schema,
  recencyAt: codexInt64Schema.nullable(),
  status: codexAppServerThreadStatusSchema,
  path: z.string().nullable(),
  cwd: z.string(),
  cliVersion: z.string(),
  source: codexAppServerSessionSourceSchema,
  canAcceptDirectInput: z.boolean().nullable(),
  threadSource: z.string().nullable(),
  agentNickname: z.string().nullable(),
  agentRole: z.string().nullable(),
  gitInfo: codexAppServerGitInfoSchema.nullable(),
  name: z.string().nullable(),
  turns: z.array(codexAppServerTurnSchema),
});

export type CodexAppServerThread = z.output<typeof codexAppServerThreadSchema>;
