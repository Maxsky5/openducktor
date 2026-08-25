import { z } from "zod";
import {
  codexAppServerMultiAgentModeSchema,
  codexAppServerReasoningEffortSchema,
  codexAppServerUserInputSchema,
} from "./codex-app-server-request-schemas";
import {
  codexInt32Schema,
  codexInt64Schema,
  codexUint16Schema,
  codexUint32Schema,
} from "./codex-app-server-number-schemas";
import { jsonValueSchema } from "./json-types";

export const codexAppServerCommandActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("read"),
    command: z.string(),
    name: z.string(),
    path: z.string(),
  }),
  z.object({
    type: z.literal("listFiles"),
    command: z.string(),
    path: z.string().nullable(),
  }),
  z.object({
    type: z.literal("search"),
    command: z.string(),
    path: z.string().nullable(),
    query: z.string().nullable(),
  }),
  z.object({
    type: z.literal("unknown"),
    command: z.string(),
  }),
]);

export const codexAppServerLegacyParsedCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("read"),
    cmd: z.string(),
    name: z.string(),
    path: z.string(),
  }),
  z.object({
    type: z.literal("list_files"),
    cmd: z.string(),
    path: z.string().nullable(),
  }),
  z.object({
    type: z.literal("search"),
    cmd: z.string(),
    path: z.string().nullable(),
    query: z.string().nullable(),
  }),
  z.object({
    type: z.literal("unknown"),
    cmd: z.string(),
  }),
]);

export const codexAppServerAdditionalNetworkPermissionsSchema = z.object({
  enabled: z.boolean().nullable(),
});

export const codexAppServerFileSystemSpecialPathSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("root") }),
  z.object({ kind: z.literal("minimal") }),
  z.object({ kind: z.literal("project_roots"), subpath: z.string().nullable() }),
  z.object({ kind: z.literal("tmpdir") }),
  z.object({ kind: z.literal("slash_tmp") }),
  z.object({
    kind: z.literal("unknown"),
    path: z.string(),
    subpath: z.string().nullable(),
  }),
]);

export const codexAppServerFileSystemPathSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("path"), path: z.string() }),
  z.object({ type: z.literal("glob_pattern"), pattern: z.string() }),
  z.object({ type: z.literal("special"), value: codexAppServerFileSystemSpecialPathSchema }),
]);

export const codexAppServerFileSystemSandboxEntrySchema = z.object({
  path: codexAppServerFileSystemPathSchema,
  access: z.enum(["read", "write", "deny"]),
});

export const codexAppServerAdditionalFileSystemPermissionsSchema = z.object({
  read: z.array(z.string()).nullable(),
  write: z.array(z.string()).nullable(),
  globScanMaxDepth: z.number().int().positive().optional(),
  entries: z.array(codexAppServerFileSystemSandboxEntrySchema).optional(),
});

export const codexAppServerRequestPermissionProfileSchema = z.object({
  network: codexAppServerAdditionalNetworkPermissionsSchema.nullable(),
  fileSystem: codexAppServerAdditionalFileSystemPermissionsSchema.nullable(),
});

export const codexAppServerNetworkApprovalContextSchema = z.object({
  host: z.string(),
  protocol: z.enum(["http", "https", "socks5Tcp", "socks5Udp"]),
});

export const codexAppServerNetworkPolicyAmendmentSchema = z.object({
  host: z.string(),
  action: z.enum(["allow", "deny"]),
});

export const codexAppServerCurrentTimeReadParamsSchema = z.object({
  threadId: z.string(),
});

export const codexAppServerCurrentTimeReadResponseSchema = z.object({
  currentTimeAt: z.number().int(),
});

const mcpElicitationSchemaDescription = {
  title: z.string().optional(),
  description: z.string().optional(),
};
const mcpElicitationConstOptionSchema = z.object({
  const: z.string(),
  title: z.string(),
});
export const codexAppServerMcpElicitationPrimitiveSchema = z.union([
  z.object({
    type: z.literal("string"),
    ...mcpElicitationSchemaDescription,
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    format: z.enum(["email", "uri", "date", "date-time"]).optional(),
    default: z.string().optional(),
  }),
  z.object({
    type: z.enum(["number", "integer"]),
    ...mcpElicitationSchemaDescription,
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    default: z.number().optional(),
  }),
  z.object({
    type: z.literal("boolean"),
    ...mcpElicitationSchemaDescription,
    default: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("string"),
    ...mcpElicitationSchemaDescription,
    enum: z.array(z.string()),
    enumNames: z.array(z.string()).optional(),
    default: z.string().optional(),
  }),
  z.object({
    type: z.literal("string"),
    ...mcpElicitationSchemaDescription,
    oneOf: z.array(mcpElicitationConstOptionSchema),
    default: z.string().optional(),
  }),
  z.object({
    type: z.literal("array"),
    ...mcpElicitationSchemaDescription,
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    items: z.union([
      z.object({ type: z.literal("string"), enum: z.array(z.string()) }),
      z.object({ anyOf: z.array(mcpElicitationConstOptionSchema) }),
    ]),
    default: z.array(z.string()).optional(),
  }),
]);

const codexAppServerMcpElicitationFormSchema = z.object({
  $schema: z.string().optional(),
  type: z.literal("object"),
  properties: z.record(z.string(), codexAppServerMcpElicitationPrimitiveSchema),
  required: z.array(z.string()).optional(),
});

export const codexAppServerMcpServerElicitationRequestParamsSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("form"),
    threadId: z.string(),
    turnId: z.string().nullable(),
    serverName: z.string(),
    _meta: jsonValueSchema.nullable(),
    message: z.string(),
    requestedSchema: codexAppServerMcpElicitationFormSchema,
  }),
  z.object({
    mode: z.literal("openai/form"),
    threadId: z.string(),
    turnId: z.string().nullable(),
    serverName: z.string(),
    _meta: jsonValueSchema.nullable(),
    message: z.string(),
    requestedSchema: jsonValueSchema,
  }),
  z.object({
    mode: z.literal("url"),
    threadId: z.string(),
    turnId: z.string().nullable(),
    serverName: z.string(),
    _meta: jsonValueSchema.nullable(),
    message: z.string(),
    url: z.string(),
    elicitationId: z.string(),
  }),
]);

export const codexAppServerExecCommandApprovalParamsSchema = z.object({
  approvalId: z.string().nullable(),
  callId: z.string(),
  command: z.array(z.string()),
  conversationId: z.string(),
  cwd: z.string(),
  parsedCmd: z.array(codexAppServerLegacyParsedCommandSchema),
  reason: z.string().nullable(),
});

export const codexAppServerCommandExecutionApprovalDecisionSchema = z.union([
  z.enum(["accept", "acceptForSession", "decline", "cancel"]),
  z.object({
    acceptWithExecpolicyAmendment: z.object({
      execpolicy_amendment: z.array(z.string()),
    }),
  }),
  z.object({
    applyNetworkPolicyAmendment: z.object({
      network_policy_amendment: codexAppServerNetworkPolicyAmendmentSchema,
    }),
  }),
]);

export const codexAppServerCommandExecutionRequestApprovalParamsSchema = z.object({
  itemId: z.string(),
  startedAtMs: z.number().int(),
  threadId: z.string(),
  turnId: z.string(),
  environmentId: z.string().nullable(),
  additionalPermissions: codexAppServerRequestPermissionProfileSchema.nullable().optional(),
  approvalId: z.string().nullable().optional(),
  command: z.string().nullable().optional(),
  commandActions: z.array(codexAppServerCommandActionSchema).nullable().optional(),
  cwd: z.string().nullable().optional(),
  networkApprovalContext: codexAppServerNetworkApprovalContextSchema.nullable().optional(),
  reason: z.string().nullable().optional(),
  proposedExecpolicyAmendment: z.array(z.string()).nullable().optional(),
  proposedNetworkPolicyAmendments: z
    .array(codexAppServerNetworkPolicyAmendmentSchema)
    .nullable()
    .optional(),
  availableDecisions: z
    .array(codexAppServerCommandExecutionApprovalDecisionSchema)
    .nullable()
    .optional(),
});

export const codexAppServerPermissionsRequestApprovalParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  environmentId: z.string().nullable(),
  startedAtMs: z.number().int(),
  cwd: z.string(),
  reason: z.string().nullable(),
  permissions: codexAppServerRequestPermissionProfileSchema,
});

const codexAppServerAskForApprovalSchema = z.union([
  z.enum(["never", "on-request", "untrusted"]),
  z.object({
    granular: z.object({
      mcp_elicitations: z.boolean(),
      request_permissions: z.boolean(),
      rules: z.boolean(),
      sandbox_approval: z.boolean(),
      skill_approval: z.boolean(),
    }),
  }),
]);

const codexAppServerSandboxPolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dangerFullAccess") }),
  z.object({
    type: z.literal("externalSandbox"),
    networkAccess: z.enum(["restricted", "enabled"]),
  }),
  z.object({ type: z.literal("readOnly"), networkAccess: z.boolean() }),
  z.object({
    type: z.literal("workspaceWrite"),
    excludeSlashTmp: z.boolean(),
    excludeTmpdirEnvVar: z.boolean(),
    networkAccess: z.boolean(),
    writableRoots: z.array(z.string()),
  }),
]);

export const codexAppServerThreadStatusSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("active"),
    activeFlags: z.array(z.enum(["waitingOnApproval", "waitingOnUserInput"])),
  }),
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("notLoaded") }),
  z.object({ type: z.literal("systemError") }),
]);

export type CodexAppServerAdditionalFileSystemPermissions = z.output<
  typeof codexAppServerAdditionalFileSystemPermissionsSchema
>;
export type CodexAppServerAdditionalNetworkPermissions = z.output<
  typeof codexAppServerAdditionalNetworkPermissionsSchema
>;
export type CodexAppServerCommandAction = z.output<typeof codexAppServerCommandActionSchema>;
export type CodexAppServerCommandExecutionApprovalDecision = z.output<
  typeof codexAppServerCommandExecutionApprovalDecisionSchema
>;
export type CodexAppServerCommandExecutionRequestApprovalParams = z.output<
  typeof codexAppServerCommandExecutionRequestApprovalParamsSchema
>;
export type CodexAppServerCurrentTimeReadParams = z.output<
  typeof codexAppServerCurrentTimeReadParamsSchema
>;
export type CodexAppServerCurrentTimeReadResponse = z.output<
  typeof codexAppServerCurrentTimeReadResponseSchema
>;
export type CodexAppServerExecCommandApprovalParams = z.output<
  typeof codexAppServerExecCommandApprovalParamsSchema
>;
export type CodexAppServerFileSystemPath = z.output<typeof codexAppServerFileSystemPathSchema>;
export type CodexAppServerFileSystemSandboxEntry = z.output<
  typeof codexAppServerFileSystemSandboxEntrySchema
>;
export type CodexAppServerFileSystemSpecialPath = z.output<
  typeof codexAppServerFileSystemSpecialPathSchema
>;
export type CodexAppServerLegacyParsedCommand = z.output<
  typeof codexAppServerLegacyParsedCommandSchema
>;
export type CodexAppServerMcpElicitationPrimitiveSchema = z.output<
  typeof codexAppServerMcpElicitationPrimitiveSchema
>;
export type CodexAppServerMcpServerElicitationRequestParams = z.output<
  typeof codexAppServerMcpServerElicitationRequestParamsSchema
>;
export type CodexAppServerNetworkApprovalContext = z.output<
  typeof codexAppServerNetworkApprovalContextSchema
>;
export type CodexAppServerNetworkPolicyAmendment = z.output<
  typeof codexAppServerNetworkPolicyAmendmentSchema
>;
export type CodexAppServerPermissionsRequestApprovalParams = z.output<
  typeof codexAppServerPermissionsRequestApprovalParamsSchema
>;
export type CodexAppServerRequestPermissionProfile = z.output<
  typeof codexAppServerRequestPermissionProfileSchema
>;
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
    durationMs: z.number().int().nonnegative(),
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

const codexAppServerThreadSchema = z.object({
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

const codexAppServerActivePermissionProfileSchema = z.object({
  id: z.string(),
  extends: z.string().nullable(),
});

const codexAppServerTurnsPageSchema = z.object({
  data: z.array(codexAppServerTurnSchema),
  nextCursor: z.string().nullable(),
  backwardsCursor: z.string().nullable(),
});

const codexAppServerThreadLaunchResultSchema = z.object({
  approvalPolicy: codexAppServerAskForApprovalSchema,
  approvalsReviewer: z.enum(["auto_review", "guardian_subagent", "user"]),
  activePermissionProfile: codexAppServerActivePermissionProfileSchema.nullable(),
  cwd: z.string(),
  instructionSources: z.array(z.string()),
  model: z.string(),
  modelProvider: z.string(),
  multiAgentMode: codexAppServerMultiAgentModeSchema,
  reasoningEffort: codexAppServerReasoningEffortSchema.nullable(),
  runtimeWorkspaceRoots: z.array(z.string()),
  sandbox: codexAppServerSandboxPolicySchema,
  serviceTier: z.string().nullable(),
  thread: codexAppServerThreadSchema,
});

const codexAppServerThreadResumeResultSchema = codexAppServerThreadLaunchResultSchema.extend({
  initialTurnsPage: codexAppServerTurnsPageSchema.nullable(),
  turnsBackwardsCursor: z.string().nullable(),
  itemsBackwardsCursor: z.string().nullable(),
});

const codexAppServerReasoningEffortOptionSchema = z.object({
  description: z.string(),
  reasoningEffort: codexAppServerReasoningEffortSchema,
});

export type CodexAppServerReasoningEffortOption = z.output<
  typeof codexAppServerReasoningEffortOptionSchema
>;

const codexAppServerModelSchema = z.object({
  additionalSpeedTiers: z.array(z.string()),
  availabilityNux: z.object({ message: z.string() }).nullable(),
  defaultReasoningEffort: codexAppServerReasoningEffortSchema,
  defaultServiceTier: z.string().nullable(),
  description: z.string(),
  displayName: z.string(),
  hidden: z.boolean(),
  id: z.string(),
  inputModalities: z.array(z.enum(["text", "image", "audio"])),
  isDefault: z.boolean(),
  model: z.string(),
  modelSpecialty: z.string().nullable(),
  multiAgentVersion: z.enum(["disabled", "v1", "v2"]).nullable(),
  serviceTiers: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
  supportedReasoningEfforts: z.array(codexAppServerReasoningEffortOptionSchema),
  supportsPersonality: z.boolean(),
  upgrade: z.string().nullable(),
  upgradeInfo: z
    .object({
      model: z.string(),
      upgradeCopy: z.string().nullable(),
      modelLink: z.string().nullable(),
      migrationMarkdown: z.string().nullable(),
      retirementAt: codexInt64Schema.nullable(),
    })
    .nullable(),
});

export type CodexAppServerModel = z.output<typeof codexAppServerModelSchema>;

const codexAppServerModelListResponseSchema = z.object({
  data: z.array(codexAppServerModelSchema),
  nextCursor: z.string().nullable(),
});

export type CodexAppServerModelListResponse = z.output<
  typeof codexAppServerModelListResponseSchema
>;

const codexAppServerSkillRecordSchema = z.object({
  name: z.string(),
  path: z.string(),
  scope: z.enum(["user", "repo", "system", "admin"]),
  description: z.string(),
  shortDescription: z.string().optional(),
  interface: z
    .object({
      displayName: z.string().optional(),
      shortDescription: z.string().optional(),
      iconSmall: z.string().optional(),
      iconLarge: z.string().optional(),
      iconSmallUrl: z.string().nullable(),
      iconLargeUrl: z.string().nullable(),
      brandColor: z.string().optional(),
      defaultPrompt: z.string().optional(),
    })
    .optional(),
  dependencies: z
    .object({
      tools: z.array(
        z.object({
          type: z.string(),
          value: z.string(),
          description: z.string().optional(),
          transport: z.string().optional(),
          command: z.string().optional(),
          url: z.string().optional(),
        }),
      ),
    })
    .optional(),
  enabled: z.boolean(),
});

export type CodexAppServerSkillRecord = z.output<typeof codexAppServerSkillRecordSchema>;

const codexAppServerSkillCatalogEntrySchema = z.object({
  cwd: z.string(),
  skills: z.array(codexAppServerSkillRecordSchema),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});

export type CodexAppServerSkillCatalogEntry = z.output<
  typeof codexAppServerSkillCatalogEntrySchema
>;

const codexAppServerSkillsListResponseSchema = z.object({
  data: z.array(codexAppServerSkillCatalogEntrySchema),
});

export type CodexAppServerSkillsListResponse = z.output<
  typeof codexAppServerSkillsListResponseSchema
>;

const codexAppServerRequestResultSchemas = {
  initialize: z.object({
    codexHome: z.string(),
    platformFamily: z.string(),
    platformOs: z.string(),
    userAgent: z.string(),
  }),
  "model/list": codexAppServerModelListResponseSchema,
  "thread/fork": codexAppServerThreadLaunchResultSchema,
  "thread/list": z.object({
    backwardsCursor: z.string().nullable(),
    data: z.array(codexAppServerThreadSchema),
    nextCursor: z.string().nullable(),
  }),
  "thread/loaded/list": z.object({
    data: z.array(z.string()),
    nextCursor: z.string().nullable(),
  }),
  "thread/read": z.object({ thread: codexAppServerThreadSchema }),
  "thread/resume": codexAppServerThreadResumeResultSchema,
  "thread/start": codexAppServerThreadLaunchResultSchema,
  "thread/name/set": z.object({}).strict(),
  "thread/compact/start": z.object({}).strict(),
  "thread/turns/list": z.object({
    backwardsCursor: z.string().nullable(),
    data: z.array(codexAppServerTurnSchema),
    nextCursor: z.string().nullable(),
  }),
  "skills/list": codexAppServerSkillsListResponseSchema,
  "turn/start": z.object({ turn: codexAppServerTurnSchema }),
  "turn/steer": z.object({ turnId: z.string() }),
  "turn/interrupt": z.object({}).strict(),
  gitDiffToRemote: z.object({ diff: z.string(), sha: z.string() }),
  fuzzyFileSearch: z.object({
    files: z.array(
      z.object({
        root: z.string(),
        path: z.string(),
        match_type: z.enum(["file", "directory"]),
        file_name: z.string(),
        score: codexUint32Schema,
        indices: z.array(codexUint32Schema).nullable(),
      }),
    ),
  }),
};

export type CodexAppServerRequestResultMap = {
  [Method in keyof typeof codexAppServerRequestResultSchemas]: z.output<
    (typeof codexAppServerRequestResultSchemas)[Method]
  >;
};

export const codexAppServerRequestResultSchema = z.union([
  codexAppServerRequestResultSchemas.initialize,
  codexAppServerRequestResultSchemas["model/list"],
  codexAppServerRequestResultSchemas["thread/fork"],
  codexAppServerRequestResultSchemas["thread/list"],
  codexAppServerRequestResultSchemas["thread/loaded/list"],
  codexAppServerRequestResultSchemas["thread/read"],
  codexAppServerRequestResultSchemas["thread/resume"],
  codexAppServerRequestResultSchemas["thread/start"],
  codexAppServerRequestResultSchemas["thread/name/set"],
  codexAppServerRequestResultSchemas["thread/compact/start"],
  codexAppServerRequestResultSchemas["thread/turns/list"],
  codexAppServerRequestResultSchemas["skills/list"],
  codexAppServerRequestResultSchemas["turn/start"],
  codexAppServerRequestResultSchemas["turn/steer"],
  codexAppServerRequestResultSchemas["turn/interrupt"],
  codexAppServerRequestResultSchemas.gitDiffToRemote,
  codexAppServerRequestResultSchemas.fuzzyFileSearch,
]);

export const parseCodexAppServerRequestResultValue = <
  Method extends keyof CodexAppServerRequestResultMap,
>(
  method: Method,
  value: unknown,
): CodexAppServerRequestResultMap[Method] => {
  const parsed = codexAppServerRequestResultSchemas[method].parse(value);
  // SAFETY: `method` selects the schema whose output defines the same method key in the result map.
  return parsed as CodexAppServerRequestResultMap[Method];
};
