import { z } from "zod";
import { directMergeRecordSchema, gitTargetBranchSchema, pullRequestSchema } from "./git-schemas";
import { jsonValueSchema } from "./json-types";
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
  linkedPullRequest: jsonValueSchema.optional(),
  directMerge: jsonValueSchema.optional(),
});
const legacyTaskMetadataPayloadSchema = z.object({
  ...taskMetadataPayloadFields,
  delivery: legacyTaskDeliverySchema.optional(),
});

export const taskMetadataPayloadSchema = legacyTaskMetadataPayloadSchema
  .transform(({ delivery, ...payload }): z.input<typeof taskMetadataPayloadBodySchema> => {
    if (payload.pullRequest === undefined && delivery?.linkedPullRequest !== undefined) {
      payload.pullRequest = pullRequestSchema.parse(delivery.linkedPullRequest);
    }
    if (payload.directMerge === undefined && delivery?.directMerge !== undefined) {
      payload.directMerge = directMergeRecordSchema.parse(delivery.directMerge);
    }
    return payload;
  })
  .pipe(taskMetadataPayloadBodySchema);
export type TaskMetadataPayload = z.infer<typeof taskMetadataPayloadSchema>;
