import { z } from "zod";
import { directMergeRecordSchema, gitTargetBranchSchema, pullRequestSchema } from "./git-schemas";
import { agentSessionRecordSchema } from "./session-schemas";
import { qaWorkflowVerdictSchema } from "./task-schemas";

export const taskMetadataDocumentSchema = z.object({
  markdown: z.string().default(""),
  updatedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  revision: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.number().int().nonnegative().optional(),
  ),
  error: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type TaskMetadataDocument = z.infer<typeof taskMetadataDocumentSchema>;

export const taskMetadataQaReportSchema = z.object({
  markdown: z.string(),
  verdict: qaWorkflowVerdictSchema,
  updatedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  revision: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.number().int().nonnegative().optional(),
  ),
  error: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type TaskMetadataQaReport = z.infer<typeof taskMetadataQaReportSchema>;

const taskMetadataPayloadFields = {
  spec: taskMetadataDocumentSchema,
  plan: taskMetadataDocumentSchema,
  targetBranch: z.preprocess(
    (value) => (value === null ? undefined : value),
    gitTargetBranchSchema.optional(),
  ),
  qaReport: z.preprocess(
    (value) => (value === null ? undefined : value),
    taskMetadataQaReportSchema.optional(),
  ),
  pullRequest: z.preprocess(
    (value) => (value === null ? undefined : value),
    pullRequestSchema.optional(),
  ),
  directMerge: z.preprocess(
    (value) => (value === null ? undefined : value),
    directMergeRecordSchema.optional(),
  ),
  agentSessions: z.array(agentSessionRecordSchema).default([]),
};

const taskMetadataPayloadBodySchema = z.object(taskMetadataPayloadFields);
const legacyTaskDeliverySchema = z.object({
  linkedPullRequest: pullRequestSchema.nullable().optional(),
  directMerge: directMergeRecordSchema.nullable().optional(),
});
const legacyTaskMetadataPayloadSchema = z.object({
  ...taskMetadataPayloadFields,
  delivery: legacyTaskDeliverySchema.nullish(),
});

export const taskMetadataPayloadSchema = legacyTaskMetadataPayloadSchema
  .transform(({ delivery, ...payload }): z.input<typeof taskMetadataPayloadBodySchema> => {
    const linkedPullRequest = delivery?.linkedPullRequest;
    if (
      payload.pullRequest === undefined &&
      linkedPullRequest !== null &&
      linkedPullRequest !== undefined
    ) {
      payload.pullRequest = linkedPullRequest;
    }
    const legacyDirectMerge = delivery?.directMerge;
    if (
      payload.directMerge === undefined &&
      legacyDirectMerge !== null &&
      legacyDirectMerge !== undefined
    ) {
      payload.directMerge = legacyDirectMerge;
    }
    return payload;
  })
  .pipe(taskMetadataPayloadBodySchema);
export type TaskMetadataPayload = z.infer<typeof taskMetadataPayloadSchema>;
