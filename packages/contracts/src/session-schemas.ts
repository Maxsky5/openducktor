import { z } from "zod";
import {
  runtimeApprovalReplyOutcomeSchema,
  runtimeApprovalRequestTypeSchema,
  runtimeKindSchema,
} from "./agent-runtime-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";

export const agentSessionStatusSchema = z.enum(["starting", "running", "idle", "error", "stopped"]);
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>;

export const agentSessionRoleSchema = agentRoleSchema;
export type AgentSessionRole = z.infer<typeof agentSessionRoleSchema>;

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

export const agentSessionApprovalMutationSchema = z.enum(["mutating", "read_only", "unknown"]);
export type AgentSessionApprovalMutation = z.infer<typeof agentSessionApprovalMutationSchema>;

export const agentSessionApprovalRequestSchema = z.object({
  requestId: z.string(),
  requestType: runtimeApprovalRequestTypeSchema,
  title: z.string(),
  summary: z.string().optional(),
  details: z.string().optional(),
  affectedPaths: z.array(z.string()).optional(),
  command: z
    .object({
      command: z.string(),
      workingDirectory: z.string().optional(),
    })
    .optional(),
  action: z
    .object({
      name: z.string(),
      description: z.string().optional(),
    })
    .optional(),
  tool: z
    .object({
      name: z.string(),
      title: z.string().optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  mutation: agentSessionApprovalMutationSchema.optional(),
  supportedReplyOutcomes: z.array(runtimeApprovalReplyOutcomeSchema).optional(),
  metadata: z.record(z.string(), agentSessionMetadataValueSchema).optional(),
});
export type AgentSessionApprovalRequest = z.infer<typeof agentSessionApprovalRequestSchema>;

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
  startedAt: z.string(),
  runtimeKind: runtimeKindSchema,
  workingDirectory: nonEmptyStringSchema,
  selectedModel: z.preprocess(
    (value) => (value === undefined ? null : value),
    agentSessionModelSelectionSchema.nullable(),
  ),
} satisfies z.ZodRawShape;

export const agentSessionRecordSchema = z.object(agentSessionRecordShape);
export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>;
export type AgentSessionIdentity = Pick<
  AgentSessionRecord,
  "externalSessionId" | "runtimeKind" | "workingDirectory"
>;

export const agentSessionStopTargetSchema = z.object({
  repoPath: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
  externalSessionId: nonEmptyStringSchema,
  runtimeKind: runtimeKindSchema,
  workingDirectory: nonEmptyStringSchema,
});
export type AgentSessionStopTarget = z.infer<typeof agentSessionStopTargetSchema>;
