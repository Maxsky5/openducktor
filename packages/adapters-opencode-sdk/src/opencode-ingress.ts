import type {
  Agent,
  Command,
  ConfigProvidersResponse,
  GlobalEvent,
  Message,
  Part,
  Session,
} from "@opencode-ai/sdk/v2/client";
import { exactOptionalSchema, type ExactOptional } from "@openducktor/contracts";
import { z } from "zod";
import type { UnknownRecord } from "./guards";

const unknownRecordSchema = z.record(z.string(), z.unknown());

type SdkGlobalEventPayload = GlobalEvent["payload"];
type ServerHeartbeatPayload = {
  id: string;
  type: "server.heartbeat";
  properties: Record<string, never>;
};
export type OpencodeGlobalEventPayload = SdkGlobalEventPayload | ServerHeartbeatPayload;

const directEventSchema = z.object({
  id: z.string(),
  type: z.string().refine((type) => type !== "sync"),
  properties: unknownRecordSchema,
});

const syncEventSchema = z.object({
  aggregateID: z.string(),
  data: unknownRecordSchema,
  id: z.string(),
  seq: z.number(),
  type: z.string(),
});

const syncEnvelopeSchema = z.object({
  id: z.string(),
  type: z.literal("sync"),
  syncEvent: syncEventSchema,
});

export const opencodeGlobalEventPayloadSchema = z.union([directEventSchema, syncEnvelopeSchema]);

export type ParsedOpencodeGlobalEventPayload = z.infer<typeof opencodeGlobalEventPayloadSchema>;

const formatIngressIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "payload"}: ${issue.message}`)
    .join("; ");

export const parseOpencodeGlobalEventPayload = (
  value: unknown,
): ParsedOpencodeGlobalEventPayload => {
  const record = unknownRecordSchema.safeParse(value);
  if (!record.success) {
    throw new Error("Invalid OpenCode global event payload: payload: Expected an object.");
  }

  const schema = record.data.type === "sync" ? syncEnvelopeSchema : directEventSchema;
  const parsed = schema.safeParse(record.data);
  if (!parsed.success) {
    throw new Error(
      `Invalid OpenCode global event payload: ${formatIngressIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

export type ParsedOpencodeEvent = {
  id?: string;
  type: string;
  properties: UnknownRecord;
  syncEvent?: UnknownRecord;
};

const permissionRuleSchema = z.object({
  action: z.enum(["allow", "deny", "ask"]),
  pattern: z.string(),
  permission: z.string(),
});

const opencodeAgentSchema = z.object({
  color: z.string().optional(),
  description: z.string().optional(),
  hidden: z.boolean().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  model: z
    .object({
      modelID: z.string(),
      providerID: z.string(),
    })
    .optional(),
  name: z.string(),
  native: z.boolean().optional(),
  options: unknownRecordSchema,
  permission: z.array(permissionRuleSchema),
  prompt: z.string().optional(),
  steps: z.number().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  variant: z.string().optional(),
});
export type ParsedOpencodeAgent = z.infer<typeof opencodeAgentSchema>;

export const opencodeAgentListPayloadSchema = exactOptionalSchema(
  z.array(opencodeAgentSchema),
) satisfies z.ZodType<ExactOptional<Agent[]>>;

const opencodeSlashCommandSchema = z.object({
  agent: z.string().optional(),
  description: z.string().optional(),
  hints: z.array(z.string()),
  model: z.string().optional(),
  name: z.string(),
  source: z.enum(["command", "mcp", "skill"]).optional(),
  subtask: z.boolean().optional(),
  template: z.string(),
});

export const opencodeSlashCommandListPayloadSchema = exactOptionalSchema(
  z.array(opencodeSlashCommandSchema),
) satisfies z.ZodType<ExactOptional<Command[]>>;

export const opencodeFileSearchPayloadSchema = z.array(z.string());

const modelCostSchema = z.object({
  cache: z.object({ read: z.number(), write: z.number() }),
  input: z.number(),
  output: z.number(),
});

const providerModelSchema = z.object({
  api: z.object({ id: z.string(), npm: z.string(), url: z.string() }),
  capabilities: z.object({
    attachment: z.boolean(),
    input: z.object({
      audio: z.boolean(),
      image: z.boolean(),
      pdf: z.boolean(),
      text: z.boolean(),
      video: z.boolean(),
    }),
    interleaved: z.union([z.boolean(), z.object({ field: z.string() })]),
    output: z.object({
      audio: z.boolean(),
      image: z.boolean(),
      pdf: z.boolean(),
      text: z.boolean(),
      video: z.boolean(),
    }),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    toolcall: z.boolean(),
  }),
  cost: modelCostSchema.extend({
    experimentalOver200K: modelCostSchema.optional(),
    tiers: z
      .array(
        modelCostSchema.extend({
          tier: z.object({ size: z.number(), type: z.literal("context") }),
        }),
      )
      .optional(),
  }),
  family: z.string().optional(),
  headers: z.record(z.string(), z.string()),
  id: z.string(),
  limit: z.object({ context: z.number(), input: z.number().optional(), output: z.number() }),
  name: z.string(),
  options: unknownRecordSchema,
  providerID: z.string(),
  release_date: z.string(),
  status: z.enum(["alpha", "beta", "deprecated", "active"]),
  variants: z.record(z.string(), unknownRecordSchema).optional(),
});
export type ParsedOpencodeProviderModel = z.infer<typeof providerModelSchema>;

const providerSchema = z.object({
  env: z.array(z.string()),
  id: z.string(),
  key: z.string().optional(),
  models: z.record(z.string(), providerModelSchema),
  name: z.string(),
  options: unknownRecordSchema,
  source: z.enum(["env", "config", "custom", "api"]),
});

export const opencodeProviderCatalogPayloadSchema = exactOptionalSchema(
  z.object({
    default: z.record(z.string(), z.string()),
    providers: z.array(providerSchema),
  }),
) satisfies z.ZodType<ExactOptional<ConfigProvidersResponse>>;

export type ParsedOpencodeProviderCatalog = z.infer<typeof opencodeProviderCatalogPayloadSchema>;

const sessionSnapshotFileDiffSchema = z.object({
  additions: z.number(),
  deletions: z.number(),
  file: z.string().optional(),
  patch: z.string().optional(),
  status: z.enum(["added", "deleted", "modified"]).optional(),
});

export const opencodeSessionDetailPayloadSchema = exactOptionalSchema(
  z.object({
    agent: z.string().optional(),
    cost: z.number().optional(),
    directory: z.string(),
    id: z.string(),
    metadata: unknownRecordSchema.optional(),
    model: z
      .object({
        id: z.string(),
        providerID: z.string(),
        variant: z.string().optional(),
      })
      .optional(),
    parentID: z.string().optional(),
    path: z.string().optional(),
    permission: z.array(permissionRuleSchema).optional(),
    projectID: z.string(),
    revert: z
      .object({
        diff: z.string().optional(),
        messageID: z.string(),
        partID: z.string().optional(),
        snapshot: z.string().optional(),
      })
      .optional(),
    share: z.object({ url: z.string() }).optional(),
    slug: z.string(),
    summary: z
      .object({
        additions: z.number(),
        deletions: z.number(),
        diffs: z.array(sessionSnapshotFileDiffSchema).optional(),
        files: z.number(),
      })
      .optional(),
    time: z.object({
      archived: z.number().optional(),
      compacting: z.number().optional(),
      created: z.number(),
      updated: z.number(),
    }),
    title: z.string(),
    tokens: z
      .object({
        cache: z.object({ read: z.number(), write: z.number() }),
        input: z.number(),
        output: z.number(),
        reasoning: z.number(),
      })
      .optional(),
    version: z.string(),
    workspaceID: z.string().optional(),
  }),
) satisfies z.ZodType<ExactOptional<Session>>;

export const opencodeSessionListPayloadSchema = z.array(opencodeSessionDetailPayloadSchema);

export const parseOpencodeSessionListPayload = (value: unknown): Session[] => {
  const parsed = opencodeSessionListPayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid OpenCode session list payload: ${formatIngressIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

const partEnvelopeSchema = {
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
};

const partTimeSchema = z.object({
  start: z.number(),
  end: z.number().optional(),
});

const sourceTextSchema = z.object({
  value: z.string(),
  start: z.number(),
  end: z.number(),
});

const sourceRangeSchema = z.object({
  end: z.object({ character: z.number(), line: z.number() }),
  start: z.object({ character: z.number(), line: z.number() }),
});

const filePartSourceSchema = z.discriminatedUnion("type", [
  z.object({
    path: z.string(),
    text: sourceTextSchema,
    type: z.literal("file"),
  }),
  z.object({
    kind: z.number(),
    name: z.string(),
    path: z.string(),
    range: sourceRangeSchema,
    text: sourceTextSchema,
    type: z.literal("symbol"),
  }),
  z.object({
    clientName: z.string(),
    text: sourceTextSchema,
    type: z.literal("resource"),
    uri: z.string(),
  }),
]);

const textPartSchema = z.object({
  ...partEnvelopeSchema,
  ignored: z.boolean().optional(),
  metadata: unknownRecordSchema.optional(),
  synthetic: z.boolean().optional(),
  text: z.string(),
  time: partTimeSchema.optional(),
  type: z.literal("text"),
});

const subtaskPartSchema = z.object({
  ...partEnvelopeSchema,
  agent: z.string(),
  command: z.string().optional(),
  description: z.string(),
  model: z.object({ modelID: z.string(), providerID: z.string() }).optional(),
  prompt: z.string(),
  type: z.literal("subtask"),
});

const reasoningPartSchema = z.object({
  ...partEnvelopeSchema,
  metadata: unknownRecordSchema.optional(),
  text: z.string(),
  time: partTimeSchema,
  type: z.literal("reasoning"),
});

const filePartSchema = z.object({
  ...partEnvelopeSchema,
  filename: z.string().optional(),
  mime: z.string(),
  source: filePartSourceSchema.optional(),
  type: z.literal("file"),
  url: z.string(),
});

const toolStateSchema = z.discriminatedUnion("status", [
  z.object({
    input: unknownRecordSchema,
    raw: z.string(),
    status: z.literal("pending"),
  }),
  z.object({
    input: unknownRecordSchema,
    metadata: unknownRecordSchema.optional(),
    status: z.literal("running"),
    time: z.object({ start: z.number() }),
    title: z.string().optional(),
  }),
  z.object({
    attachments: z.array(filePartSchema).optional(),
    input: unknownRecordSchema,
    metadata: unknownRecordSchema,
    output: z.string(),
    status: z.literal("completed"),
    time: z.object({
      compacted: z.number().optional(),
      end: z.number(),
      start: z.number(),
    }),
    title: z.string(),
  }),
  z.object({
    error: z.string(),
    input: unknownRecordSchema,
    metadata: unknownRecordSchema.optional(),
    status: z.literal("error"),
    time: z.object({ end: z.number(), start: z.number() }),
  }),
]);

const toolPartSchema = z.object({
  ...partEnvelopeSchema,
  callID: z.string(),
  metadata: unknownRecordSchema.optional(),
  state: toolStateSchema,
  tool: z.string(),
  type: z.literal("tool"),
});

const stepStartPartSchema = z.object({
  ...partEnvelopeSchema,
  snapshot: z.string().optional(),
  type: z.literal("step-start"),
});

const tokenUsageSchema = z.object({
  cache: z.object({ read: z.number(), write: z.number() }),
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  total: z.number().optional(),
});

const stepFinishPartSchema = z.object({
  ...partEnvelopeSchema,
  cost: z.number(),
  reason: z.string(),
  snapshot: z.string().optional(),
  tokens: tokenUsageSchema,
  type: z.literal("step-finish"),
});

const snapshotPartSchema = z.object({
  ...partEnvelopeSchema,
  snapshot: z.string(),
  type: z.literal("snapshot"),
});

const patchPartSchema = z.object({
  ...partEnvelopeSchema,
  files: z.array(z.string()),
  hash: z.string(),
  type: z.literal("patch"),
});

const agentPartSchema = z.object({
  ...partEnvelopeSchema,
  name: z.string(),
  source: sourceTextSchema.optional(),
  type: z.literal("agent"),
});

const apiErrorSchema = z.object({
  data: z.object({
    isRetryable: z.boolean(),
    message: z.string(),
    metadata: z.record(z.string(), z.string()).optional(),
    responseBody: z.string().optional(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    statusCode: z.number().optional(),
  }),
  name: z.literal("APIError"),
});

const retryPartSchema = z.object({
  ...partEnvelopeSchema,
  attempt: z.number(),
  error: apiErrorSchema,
  time: z.object({ created: z.number() }),
  type: z.literal("retry"),
});

const compactionPartSchema = z.object({
  ...partEnvelopeSchema,
  auto: z.boolean(),
  overflow: z.boolean().optional(),
  tail_start_id: z.string().optional(),
  type: z.literal("compaction"),
});

export const opencodePartPayloadSchema = exactOptionalSchema(
  z.discriminatedUnion("type", [
    textPartSchema,
    subtaskPartSchema,
    reasoningPartSchema,
    filePartSchema,
    toolPartSchema,
    stepStartPartSchema,
    stepFinishPartSchema,
    snapshotPartSchema,
    patchPartSchema,
    agentPartSchema,
    retryPartSchema,
    compactionPartSchema,
  ]),
) satisfies z.ZodType<ExactOptional<Part>>;

export type ParsedOpencodePart = z.infer<typeof opencodePartPayloadSchema>;

const snapshotFileDiffSchema = z.object({
  additions: z.number(),
  deletions: z.number(),
  file: z.string().optional(),
  patch: z.string().optional(),
  status: z.enum(["added", "deleted", "modified"]).optional(),
});

const messageErrorSchema = z.discriminatedUnion("name", [
  z.object({
    data: z.object({ message: z.string(), providerID: z.string() }),
    name: z.literal("ProviderAuthError"),
  }),
  z.object({
    data: z.object({ message: z.string(), ref: z.string().optional() }),
    name: z.literal("UnknownError"),
  }),
  z.object({ data: unknownRecordSchema, name: z.literal("MessageOutputLengthError") }),
  z.object({
    data: z.object({ message: z.string() }),
    name: z.literal("MessageAbortedError"),
  }),
  z.object({
    data: z.object({ message: z.string(), retries: z.number() }),
    name: z.literal("StructuredOutputError"),
  }),
  z.object({
    data: z.object({ message: z.string(), responseBody: z.string().optional() }),
    name: z.literal("ContextOverflowError"),
  }),
  z.object({
    data: z.object({ message: z.string() }),
    name: z.literal("ContentFilterError"),
  }),
  apiErrorSchema,
]);

const userMessageInfoSchema = z.object({
  agent: z.string(),
  format: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("text") }),
      z.object({
        retryCount: z.number().optional(),
        schema: unknownRecordSchema,
        type: z.literal("json_schema"),
      }),
    ])
    .optional(),
  id: z.string(),
  model: z.object({
    modelID: z.string(),
    providerID: z.string(),
    variant: z.string().optional(),
  }),
  role: z.literal("user"),
  sessionID: z.string(),
  summary: z
    .object({
      body: z.string().optional(),
      diffs: z.array(snapshotFileDiffSchema),
      title: z.string().optional(),
    })
    .optional(),
  system: z.string().optional(),
  time: z.object({ created: z.number() }),
  tools: z.record(z.string(), z.boolean()).optional(),
});

const assistantMessageInfoSchema = z.object({
  agent: z.string(),
  cost: z.number(),
  error: messageErrorSchema.optional(),
  finish: z.string().optional(),
  id: z.string(),
  mode: z.string(),
  modelID: z.string(),
  parentID: z.string(),
  path: z.object({ cwd: z.string(), root: z.string() }),
  providerID: z.string(),
  role: z.literal("assistant"),
  sessionID: z.string(),
  structured: z.unknown().optional(),
  summary: z.boolean().optional(),
  time: z.object({ created: z.number(), completed: z.number().optional() }),
  tokens: tokenUsageSchema,
  variant: z.string().optional(),
});

export const opencodeMessageInfoPayloadSchema = exactOptionalSchema(
  z.discriminatedUnion("role", [userMessageInfoSchema, assistantMessageInfoSchema]),
) satisfies z.ZodType<ExactOptional<Message>>;

const sessionMessageSchema = z.object({
  info: opencodeMessageInfoPayloadSchema,
  parts: z.array(opencodePartPayloadSchema),
});

export type ParsedOpencodeMessage = z.infer<typeof sessionMessageSchema>;

export const opencodeSessionMessagesPayloadSchema = z.array(sessionMessageSchema);
