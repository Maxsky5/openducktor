import { z } from "zod";
import type {
  CodexAppServerClientRequestMap,
  CodexAppServerJsonValue,
  CodexAppServerModelListResponse,
  CodexAppServerReasoningEffortOption,
  CodexAppServerRequestMethod,
  CodexAppServerSkillRecord,
  CodexAppServerSkillsListResponse,
  CodexAppServerThread,
} from "./codex-app-server-protocol";
import { codexAppServerReasoningEffortSchema } from "./codex-app-server-request-schemas";
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
  globScanMaxDepth: z.number().finite().optional(),
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

const codexAppServerMcpElicitationPrimitiveSchema = z.union([
  z.object({
    type: z.literal("string"),
    title: z.string().optional(),
    description: z.string().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    format: z.enum(["email", "uri", "date", "date-time"]).optional(),
    default: z.string().optional(),
  }),
  z.object({
    type: z.enum(["number", "integer"]),
    title: z.string().optional(),
    description: z.string().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    default: z.number().optional(),
  }),
  z.object({
    type: z.literal("boolean"),
    title: z.string().optional(),
    description: z.string().optional(),
    default: z.boolean().optional(),
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

export const codexAppServerCommandExecutionRequestApprovalParamsSchema = z.object({
  itemId: z.string(),
  startedAtMs: z.number().finite(),
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
    .array(
      z.union([
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
      ]),
    )
    .nullable()
    .optional(),
});

export const codexAppServerPermissionsRequestApprovalParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  environmentId: z.string().nullable(),
  startedAtMs: z.number().finite(),
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

const codexAppServerThreadStatusSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("active"),
    activeFlags: z.array(z.enum(["waitingOnApproval", "waitingOnUserInput"])),
  }),
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("notLoaded") }),
  z.object({ type: z.literal("systemError") }),
]);

const codexAppServerSubAgentSourceSchema = z.union([
  z.enum(["review", "compact", "memory_consolidation"]),
  z.object({ other: z.string() }),
  z.object({
    thread_spawn: z.object({
      parent_thread_id: z.string(),
      depth: z.number(),
      agent_path: jsonValueSchema.nullable(),
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

const codexAppServerTurnSchema = z.object({
  completedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
  error: jsonValueSchema.nullable(),
  id: z.string(),
  items: z.array(jsonValueSchema),
  itemsView: z.enum(["full", "notLoaded", "summary"]),
  startedAt: z.number().nullable(),
  status: jsonValueSchema,
});

const codexAppServerThreadSchema = z.object({
  id: z.string(),
  extra: z.object({}).strict().nullable(),
  sessionId: z.string(),
  forkedFromId: z.string().nullable(),
  parentThreadId: z.string().nullable(),
  preview: z.string(),
  ephemeral: z.boolean(),
  section: codexAppServerThreadSectionSchema.nullable(),
  sectionEnteredAt: z.number().nullable(),
  projectId: z.string().nullable(),
  historyMode: z.enum(["legacy", "paginated"]),
  modelProvider: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  recencyAt: z.number().nullable(),
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
}) satisfies z.ZodType<CodexAppServerThread>;

const codexAppServerThreadStartResultSchema = z.object({
  approvalPolicy: codexAppServerAskForApprovalSchema,
  approvalsReviewer: z.enum(["auto_review", "guardian_subagent", "user"]),
  cwd: z.string(),
  instructionSources: z.array(z.string()),
  model: z.string(),
  modelProvider: z.string(),
  reasoningEffort: codexAppServerReasoningEffortSchema.nullable(),
  sandbox: codexAppServerSandboxPolicySchema,
  serviceTier: z.string().nullable(),
  thread: codexAppServerThreadSchema,
});

const codexAppServerReasoningEffortOptionSchema = z
  .object({
    description: z.string().nullable().optional(),
    reasoningEffort: codexAppServerReasoningEffortSchema,
  })
  .transform((value): CodexAppServerReasoningEffortOption => {
    if (value.description === undefined) {
      return { reasoningEffort: value.reasoningEffort };
    }
    return { reasoningEffort: value.reasoningEffort, description: value.description };
  });

const codexAppServerModelListResponseSchema = z.object({
  data: z.array(
    z.object({
      additionalSpeedTiers: z.array(z.string()),
      availabilityNux: jsonValueSchema.nullable(),
      defaultReasoningEffort: codexAppServerReasoningEffortSchema,
      description: z.string(),
      displayName: z.string(),
      hidden: z.boolean(),
      id: z.string(),
      inputModalities: z.array(z.string()),
      isDefault: z.boolean(),
      model: z.string(),
      serviceTiers: z.array(jsonValueSchema),
      supportedReasoningEfforts: z.array(codexAppServerReasoningEffortOptionSchema),
      supportsPersonality: z.boolean(),
      upgrade: z.string().nullable(),
      upgradeInfo: jsonValueSchema.nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<CodexAppServerModelListResponse>;

const codexAppServerSkillRecordSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    scope: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().nullable().optional(),
  })
  .transform((value): CodexAppServerSkillRecord => {
    const skill: CodexAppServerSkillRecord = { name: value.name, path: value.path };
    if (value.scope !== undefined) {
      skill.scope = value.scope;
    }
    if (value.title !== undefined) {
      skill.title = value.title;
    }
    if (value.displayName !== undefined) {
      skill.displayName = value.displayName;
    }
    if (value.description !== undefined) {
      skill.description = value.description;
    }
    if (value.enabled !== undefined) {
      skill.enabled = value.enabled;
    }
    return skill;
  });

const codexAppServerSkillsListResponseSchema = z
  .object({
    data: z.array(
      z.object({
        cwd: z.string(),
        skills: z.array(codexAppServerSkillRecordSchema),
      }),
    ),
    errors: z.array(jsonValueSchema).nullable().optional(),
  })
  .transform((value): CodexAppServerSkillsListResponse => {
    if (value.errors === undefined) {
      return { data: value.data };
    }
    return { data: value.data, errors: value.errors };
  });

type CodexAppServerRequestResultSchemaMap = {
  [Method in CodexAppServerRequestMethod]: z.ZodType<
    CodexAppServerClientRequestMap[Method]["result"]
  >;
};

const codexAppServerRequestResultSchemas = {
  initialize: z.object({
    codexHome: z.string(),
    platformFamily: z.string(),
    platformOs: z.string(),
    userAgent: z.string(),
  }),
  "model/list": codexAppServerModelListResponseSchema,
  "thread/fork": codexAppServerThreadStartResultSchema,
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
  "thread/resume": codexAppServerThreadStartResultSchema,
  "thread/start": codexAppServerThreadStartResultSchema,
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
        score: z.number(),
        indices: z.array(z.number()).nullable(),
      }),
    ),
  }),
} satisfies CodexAppServerRequestResultSchemaMap;

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

export const parseCodexAppServerRequestResultValue = <Method extends CodexAppServerRequestMethod>(
  method: Method,
  value: CodexAppServerJsonValue,
): CodexAppServerClientRequestMap[Method]["result"] =>
  codexAppServerRequestResultSchemas[method].parse(value);
