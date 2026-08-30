import type { Agent, Session } from "@opencode-ai/sdk/v2/client";
import { z } from "zod";
import { opencodeProtocolObjectSchema, opencodeProtocolValueSchema } from "./guards";

const formatIngressIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "payload"}: ${issue.message}`)
    .join("; ");

const permissionRuleSchema = z.object({
  action: z.enum(["allow", "deny", "ask"]),
  pattern: z.string(),
  permission: z.string(),
});

const opencodeAgentWireSchema = z.object({
  color: z.string().nullish(),
  description: z.string().nullish(),
  hidden: z.boolean().nullish(),
  mode: z.enum(["subagent", "primary", "all"]),
  model: z
    .object({
      modelID: z.string(),
      providerID: z.string(),
    })
    .nullish(),
  name: z.string(),
  native: z.boolean().nullish(),
  options: opencodeProtocolObjectSchema,
  permission: z.array(permissionRuleSchema),
  prompt: z.string().nullish(),
  steps: z.number().nullish(),
  temperature: z.number().nullish(),
  topP: z.number().nullish(),
  variant: z.string().nullish(),
});

const opencodeAgentSchema = opencodeAgentWireSchema.transform((agent): Agent => {
  const parsedAgent: Agent = {
    mode: agent.mode,
    name: agent.name,
    options: agent.options,
    permission: agent.permission,
  };
  if (agent.color != null) {
    parsedAgent.color = agent.color;
  }
  if (agent.description != null) {
    parsedAgent.description = agent.description;
  }
  if (agent.hidden != null) {
    parsedAgent.hidden = agent.hidden;
  }
  if (agent.model != null) {
    parsedAgent.model = agent.model;
  }
  if (agent.native != null) {
    parsedAgent.native = agent.native;
  }
  if (agent.prompt != null) {
    parsedAgent.prompt = agent.prompt;
  }
  if (agent.steps != null) {
    parsedAgent.steps = agent.steps;
  }
  if (agent.temperature != null) {
    parsedAgent.temperature = agent.temperature;
  }
  if (agent.topP != null) {
    parsedAgent.topP = agent.topP;
  }
  if (agent.variant != null) {
    parsedAgent.variant = agent.variant;
  }
  return parsedAgent;
});
export type ParsedOpencodeAgent = z.infer<typeof opencodeAgentSchema>;

export const opencodeAgentListPayloadSchema = z.array(opencodeAgentSchema);

const opencodeSlashCommandSchema = z.object({
  description: z.string().nullish(),
  hints: z.array(z.string()),
  name: z.string(),
  source: z.enum(["command", "mcp", "skill"]).nullish(),
});

export const opencodeSlashCommandListPayloadSchema = z.array(opencodeSlashCommandSchema);

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
  options: opencodeProtocolObjectSchema,
  providerID: z.string(),
  release_date: z.string(),
  status: z.enum(["alpha", "beta", "deprecated", "active"]),
  variants: z.record(z.string(), opencodeProtocolObjectSchema).optional(),
});
export type ParsedOpencodeProviderModel = z.infer<typeof providerModelSchema>;

const providerSchema = z.object({
  env: z.array(z.string()),
  id: z.string(),
  key: z.string().optional(),
  models: z.record(z.string(), providerModelSchema),
  name: z.string(),
  options: opencodeProtocolObjectSchema,
  source: z.enum(["env", "config", "custom", "api"]),
});

export const opencodeProviderCatalogPayloadSchema = z.object({
  default: z.record(z.string(), z.string()),
  providers: z.array(providerSchema),
});

export type ParsedOpencodeProviderCatalog = z.infer<typeof opencodeProviderCatalogPayloadSchema>;

const snapshotFileDiffSummarySchema = z.object({
  additions: z.number(),
  deletions: z.number(),
  file: z.string().optional(),
  patch: z.string().optional(),
  status: z.enum(["added", "deleted", "modified"]).optional(),
});

export const opencodeSessionDetailPayloadSchema = z.object({
  agent: z.string().optional(),
  cost: z.number().optional(),
  directory: z.string(),
  id: z.string(),
  metadata: opencodeProtocolObjectSchema.optional(),
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
      diffs: z.array(snapshotFileDiffSummarySchema).optional(),
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
});

export type ParsedOpencodeSession = z.output<typeof opencodeSessionDetailPayloadSchema>;
const opencodeSessionListPayloadSchema = z.array(opencodeSessionDetailPayloadSchema);

export const parseOpencodeSessionListPayload = (value: Session[]): ParsedOpencodeSession[] => {
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
  metadata: opencodeProtocolObjectSchema.optional(),
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
  metadata: opencodeProtocolObjectSchema.optional(),
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
    input: opencodeProtocolObjectSchema,
    raw: z.string(),
    status: z.literal("pending"),
  }),
  z.object({
    input: opencodeProtocolObjectSchema,
    metadata: opencodeProtocolObjectSchema.optional(),
    status: z.literal("running"),
    time: z.object({ start: z.number() }),
    title: z.string().optional(),
  }),
  z.object({
    attachments: z.array(filePartSchema).optional(),
    input: opencodeProtocolObjectSchema,
    metadata: opencodeProtocolObjectSchema,
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
    input: opencodeProtocolObjectSchema,
    metadata: opencodeProtocolObjectSchema.optional(),
    status: z.literal("error"),
    time: z.object({ end: z.number(), start: z.number() }),
  }),
]);

const toolPartSchema = z.object({
  ...partEnvelopeSchema,
  callID: z.string(),
  metadata: opencodeProtocolObjectSchema.optional(),
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

export const opencodePartPayloadSchema = z.discriminatedUnion("type", [
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
]);

export type ParsedOpencodePart = z.infer<typeof opencodePartPayloadSchema>;

export const opencodeMessageErrorSchema = z.discriminatedUnion("name", [
  z.object({
    data: z.object({ message: z.string(), providerID: z.string() }),
    name: z.literal("ProviderAuthError"),
  }),
  z.object({
    data: z.object({ message: z.string(), ref: z.string().optional() }),
    name: z.literal("UnknownError"),
  }),
  z.object({ data: opencodeProtocolObjectSchema, name: z.literal("MessageOutputLengthError") }),
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
        schema: opencodeProtocolObjectSchema,
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
      diffs: z.array(snapshotFileDiffSummarySchema),
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
  error: opencodeMessageErrorSchema.optional(),
  finish: z.string().optional(),
  id: z.string(),
  mode: z.string(),
  modelID: z.string(),
  parentID: z.string(),
  path: z.object({ cwd: z.string(), root: z.string() }),
  providerID: z.string(),
  role: z.literal("assistant"),
  sessionID: z.string(),
  structured: opencodeProtocolValueSchema.optional(),
  summary: z.boolean().optional(),
  time: z.object({ created: z.number(), completed: z.number().optional() }),
  tokens: tokenUsageSchema,
  variant: z.string().optional(),
});

export const opencodeMessageInfoPayloadSchema = z.discriminatedUnion("role", [
  userMessageInfoSchema,
  assistantMessageInfoSchema,
]);

const sessionMessageSchema = z.object({
  info: opencodeMessageInfoPayloadSchema,
  parts: z.array(opencodePartPayloadSchema),
});

export type ParsedOpencodeMessage = z.infer<typeof sessionMessageSchema>;

export const opencodeSessionMessagesPayloadSchema = z.array(sessionMessageSchema);
