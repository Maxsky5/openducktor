import { z } from "zod";
import {
  codexInt64Schema,
  codexUint32Schema,
  codexUint64Schema,
  codexUsizeSchema,
} from "./codex-app-server-number-schemas";

const codexAppServerJsonValueSchema = z.json();

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
  globScanMaxDepth: codexUsizeSchema.positive().optional(),
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
  currentTimeAt: codexInt64Schema,
});

const mcpElicitationSchemaDescription = {
  title: z.string().optional(),
  description: z.string().optional(),
};
const mcpElicitationConstOptionSchema = z
  .object({
    const: z.string(),
    title: z.string(),
  })
  .strict();
export const codexAppServerMcpElicitationPrimitiveSchema = z.union([
  z
    .object({
      type: z.literal("string"),
      ...mcpElicitationSchemaDescription,
      minLength: codexUint32Schema.optional(),
      maxLength: codexUint32Schema.optional(),
      format: z.enum(["email", "uri", "date", "date-time"]).optional(),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum(["number", "integer"]),
      ...mcpElicitationSchemaDescription,
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      default: z.number().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("boolean"),
      ...mcpElicitationSchemaDescription,
      default: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("string"),
      ...mcpElicitationSchemaDescription,
      enum: z.array(z.string()),
      enumNames: z.array(z.string()).optional(),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("string"),
      ...mcpElicitationSchemaDescription,
      oneOf: z.array(mcpElicitationConstOptionSchema),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("array"),
      ...mcpElicitationSchemaDescription,
      minItems: codexUint64Schema.optional(),
      maxItems: codexUint64Schema.optional(),
      items: z.union([
        z.object({ type: z.literal("string"), enum: z.array(z.string()) }).strict(),
        z.object({ anyOf: z.array(mcpElicitationConstOptionSchema) }).strict(),
      ]),
      default: z.array(z.string()).optional(),
    })
    .strict(),
]);

const codexAppServerMcpElicitationFormSchema = z
  .object({
    $schema: z.string().optional(),
    type: z.literal("object"),
    properties: z.record(z.string(), codexAppServerMcpElicitationPrimitiveSchema),
    required: z.array(z.string()).optional(),
  })
  .strict();

export const codexAppServerMcpServerElicitationRequestParamsSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("form"),
    threadId: z.string(),
    turnId: z.string().nullable(),
    serverName: z.string(),
    _meta: codexAppServerJsonValueSchema.nullable(),
    message: z.string(),
    requestedSchema: codexAppServerMcpElicitationFormSchema,
  }),
  z.object({
    mode: z.literal("openai/form"),
    threadId: z.string(),
    turnId: z.string().nullable(),
    serverName: z.string(),
    _meta: codexAppServerJsonValueSchema.nullable(),
    message: z.string(),
    requestedSchema: codexAppServerJsonValueSchema,
  }),
  z.object({
    mode: z.literal("url"),
    threadId: z.string(),
    turnId: z.string().nullable(),
    serverName: z.string(),
    _meta: codexAppServerJsonValueSchema.nullable(),
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
  startedAtMs: codexInt64Schema,
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
  startedAtMs: codexInt64Schema,
  cwd: z.string(),
  reason: z.string().nullable(),
  permissions: codexAppServerRequestPermissionProfileSchema,
});

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
