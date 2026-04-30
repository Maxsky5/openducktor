import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { agentRoleSchema, agentScenarioSchema } from "./agent-workflow-schemas";

export const agentSessionStatusSchema = z.enum(["starting", "running", "idle", "error", "stopped"]);
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>;

export const agentSessionRoleSchema = agentRoleSchema;
export type AgentSessionRole = z.infer<typeof agentSessionRoleSchema>;

export const agentSessionScenarioSchema = agentScenarioSchema;
export type AgentSessionScenario = z.infer<typeof agentSessionScenarioSchema>;

const optionalFromNullable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

const nonEmptyStringSchema = z.string().trim().min(1);

const agentSessionMetadataValueSchema: z.ZodType<
  string | number | boolean | null | undefined | Array<unknown> | Record<string, unknown>
> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.undefined(),
    z.array(agentSessionMetadataValueSchema),
    z.record(z.string(), agentSessionMetadataValueSchema),
  ]),
);

export const agentSessionModelSelectionSchema = z.object({
  runtimeKind: runtimeKindSchema,
  providerId: z.string(),
  modelId: z.string(),
  variant: optionalFromNullable(z.string()),
  profileId: optionalFromNullable(z.string()),
});
export type AgentSessionModelSelection = z.infer<typeof agentSessionModelSelectionSchema>;

export const agentSessionPermissionRequestSchema = z.object({
  requestId: z.string(),
  permission: z.string(),
  patterns: z.array(z.string()).default([]),
  metadata: z.record(z.string(), agentSessionMetadataValueSchema).optional(),
});
export type AgentSessionPermissionRequest = z.infer<typeof agentSessionPermissionRequestSchema>;

export const agentSessionQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});
export type AgentSessionQuestionOption = z.infer<typeof agentSessionQuestionOptionSchema>;

export const agentSessionQuestionItemSchema = z.object({
  header: z.string(),
  question: z.string(),
  options: z.array(agentSessionQuestionOptionSchema).default([]),
  multiple: z.boolean().optional(),
  custom: z.boolean().optional(),
});
export type AgentSessionQuestionItem = z.infer<typeof agentSessionQuestionItemSchema>;

export const agentSessionQuestionRequestSchema = z.object({
  requestId: z.string(),
  questions: z.array(agentSessionQuestionItemSchema).default([]),
});
export type AgentSessionQuestionRequest = z.infer<typeof agentSessionQuestionRequestSchema>;

const agentSessionRecordShape = {
  externalSessionId: nonEmptyStringSchema,
  role: agentSessionRoleSchema,
  scenario: agentSessionScenarioSchema,
  startedAt: z.string(),
  runtimeKind: runtimeKindSchema,
  workingDirectory: z.string(),
  selectedModel: z.preprocess(
    (value) => (value === undefined ? null : value),
    agentSessionModelSelectionSchema.nullable(),
  ),
} satisfies z.ZodRawShape;

export const agentSessionRecordSchema = z.object(agentSessionRecordShape).strict();
export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>;

const legacyAgentSessionRecordSchema = z.object({
  ...agentSessionRecordShape,
  externalSessionId: optionalFromNullable(nonEmptyStringSchema),
  sessionId: optionalFromNullable(nonEmptyStringSchema),
});

export const parseAgentSessionRecordCompat = (value: unknown): AgentSessionRecord => {
  const legacyRecord = legacyAgentSessionRecordSchema.parse(value);
  const legacySessionId = legacyRecord.sessionId;
  const externalSessionId = legacyRecord.externalSessionId;

  if (legacySessionId && externalSessionId && legacySessionId !== externalSessionId) {
    throw new Error(
      "Invalid agent session record metadata: sessionId and externalSessionId differ; fix saved task metadata and retry.",
    );
  }

  const canonicalExternalSessionId = externalSessionId ?? legacySessionId;
  if (!canonicalExternalSessionId) {
    throw new Error(
      "Invalid agent session record metadata: externalSessionId is required; fix saved task metadata and retry.",
    );
  }

  return agentSessionRecordSchema.parse({
    externalSessionId: canonicalExternalSessionId,
    role: legacyRecord.role,
    scenario: legacyRecord.scenario,
    startedAt: legacyRecord.startedAt,
    runtimeKind: legacyRecord.runtimeKind,
    workingDirectory: legacyRecord.workingDirectory,
    selectedModel: legacyRecord.selectedModel,
  });
};

export const agentSessionStopTargetSchema = z.object({
  repoPath: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
  externalSessionId: nonEmptyStringSchema,
  runtimeKind: runtimeKindSchema,
  workingDirectory: nonEmptyStringSchema,
});
export type AgentSessionStopTarget = z.infer<typeof agentSessionStopTargetSchema>;
