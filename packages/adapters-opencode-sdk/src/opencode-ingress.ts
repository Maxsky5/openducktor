import { jsonValueSchema } from "@openducktor/contracts";
import { z } from "zod";
import type { UnknownRecord } from "./guards";

const jsonRecordSchema = z.record(z.string(), jsonValueSchema);
export type OpenCodeExternalValue = z.input<typeof jsonValueSchema>;

const directEventSchema = z.object({
  id: z.string().optional(),
  type: z.string().refine((type) => type !== "sync"),
  properties: jsonRecordSchema,
});

const syncEventSchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    data: jsonRecordSchema,
  })
  .catchall(jsonValueSchema);

const syncEnvelopeSchema = z
  .object({
    id: z.string().optional(),
    type: z.literal("sync"),
    syncEvent: syncEventSchema,
  })
  .catchall(jsonValueSchema);

export const opencodeGlobalEventPayloadSchema = z.union([directEventSchema, syncEnvelopeSchema]);

export type ParsedOpencodeGlobalEventPayload = z.infer<typeof opencodeGlobalEventPayloadSchema>;

const formatIngressIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "payload"}: ${issue.message}`)
    .join("; ");

export const parseOpencodeGlobalEventPayload = (
  value: OpenCodeExternalValue,
): ParsedOpencodeGlobalEventPayload => {
  const json = jsonValueSchema.safeParse(value);
  if (!json.success) {
    throw new Error(
      `Invalid OpenCode global event payload: ${formatIngressIssues(json.error.issues)}`,
    );
  }
  const record = jsonRecordSchema.safeParse(json.data);
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

export const opencodeAgentListPayloadSchema = z.array(jsonValueSchema);

export const opencodeSlashCommandListPayloadSchema = z.array(jsonValueSchema);

export const opencodeFileSearchPayloadSchema = z.array(z.string());

const providerModelSchema = z
  .object({
    name: z.string().optional(),
    variants: z.record(z.string(), jsonValueSchema).optional(),
    limit: z
      .object({
        context: z.number().optional(),
        output: z.number().optional(),
      })
      .optional(),
    capabilities: z
      .object({
        input: z
          .object({
            image: z.boolean().optional(),
            audio: z.boolean().optional(),
            video: z.boolean().optional(),
            pdf: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    modalities: z
      .object({
        input: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .catchall(jsonValueSchema);

export const opencodeProviderCatalogPayloadSchema = z
  .object({
    providers: z.array(
      z
        .object({
          id: z.string().optional(),
          name: z.string().optional(),
          models: z.record(z.string(), providerModelSchema).optional(),
        })
        .catchall(jsonValueSchema),
    ),
    default: z.record(z.string(), z.string()).optional(),
  })
  .catchall(jsonValueSchema);

export type ParsedOpencodeProviderCatalog = z.infer<typeof opencodeProviderCatalogPayloadSchema>;

export const opencodeMessageInfoSchema = jsonRecordSchema;
export const opencodeSessionDetailPayloadSchema = jsonRecordSchema;
export const opencodeTokenCarrierPayloadSchema = jsonRecordSchema;

const partEnvelopeSchema = {
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
};

const partTimeSchema = z
  .object({
    start: z.number().optional(),
    end: z.number().optional(),
  })
  .catchall(jsonValueSchema);

const sourceTextSchema = z
  .object({
    value: z.string(),
    start: z.number(),
    end: z.number(),
  })
  .catchall(jsonValueSchema);

const filePartSourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("file"),
      path: z.string(),
      text: sourceTextSchema.optional(),
    })
    .catchall(jsonValueSchema),
  z
    .object({
      type: z.literal("symbol"),
      path: z.string(),
    })
    .catchall(jsonValueSchema),
  z
    .object({
      type: z.literal("resource"),
      uri: z.string(),
    })
    .catchall(jsonValueSchema),
]);

const textPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("text"),
    text: z.string(),
    synthetic: z.boolean().optional(),
    ignored: z.boolean().optional(),
    time: partTimeSchema.optional(),
  })
  .catchall(jsonValueSchema);

const subtaskPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("subtask"),
    prompt: z.string(),
    description: z.string(),
    agent: z.string(),
    model: jsonValueSchema.optional(),
    command: z.string().optional(),
  })
  .catchall(jsonValueSchema);

const reasoningPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("reasoning"),
    text: z.string(),
    time: partTimeSchema,
  })
  .catchall(jsonValueSchema);

const filePartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("file"),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(),
    source: filePartSourceSchema.optional(),
  })
  .catchall(jsonValueSchema);

const toolPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("tool"),
    callID: z.string(),
    tool: z.string(),
    state: jsonRecordSchema,
  })
  .catchall(jsonValueSchema);

const stepStartPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("step-start"),
  })
  .catchall(jsonValueSchema);

const stepFinishPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("step-finish"),
    reason: z.string(),
    cost: z.number(),
    tokens: jsonValueSchema,
  })
  .catchall(jsonValueSchema);

const snapshotPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("snapshot"),
    snapshot: z.string(),
  })
  .catchall(jsonValueSchema);

const patchPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("patch"),
    files: z.array(z.string()),
  })
  .catchall(jsonValueSchema);

const agentPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("agent"),
    name: z.string(),
    source: sourceTextSchema.optional(),
  })
  .catchall(jsonValueSchema);

const retryPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("retry"),
    attempt: z.number(),
    error: jsonRecordSchema,
    time: z.object({ created: z.number() }).catchall(jsonValueSchema),
  })
  .catchall(jsonValueSchema);

const compactionPartSchema = z
  .object({
    ...partEnvelopeSchema,
    type: z.literal("compaction"),
    auto: z.boolean(),
  })
  .catchall(jsonValueSchema);

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

const messageTimeSchema = z
  .object({
    created: z.number(),
    completed: z.number().optional(),
  })
  .catchall(jsonValueSchema);

const userMessageInfoSchema = z
  .object({
    id: z.string(),
    role: z.literal("user"),
    time: messageTimeSchema,
    system: z.string().optional(),
  })
  .catchall(jsonValueSchema);

const assistantMessageInfoSchema = z
  .object({
    id: z.string(),
    role: z.literal("assistant"),
    time: messageTimeSchema,
  })
  .catchall(jsonValueSchema);

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
