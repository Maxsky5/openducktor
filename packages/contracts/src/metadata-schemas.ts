import { z } from "zod";
import { directMergeRecordSchema, gitTargetBranchSchema, pullRequestSchema } from "./git-schemas";
import { agentSessionRecordSchema } from "./session-schemas";
import { workflowArtifactIdSchema, workflowIdSchema } from "./workflow-condition-schemas";

/** A stored workflow artifact. Only a review has a verdict. */
export const taskMetadataArtifactSchema = z.object({
  markdown: z.string().default(""),
  verdict: workflowIdSchema.optional(),
  updatedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  revision: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.number().int().nonnegative().optional(),
  ),
  error: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type TaskMetadataArtifact = z.infer<typeof taskMetadataArtifactSchema>;

const taskMetadataPayloadFields = {
  /** The stored workflow artifacts keyed by artifact code. */
  artifacts: z.record(workflowArtifactIdSchema, taskMetadataArtifactSchema).default({}),
  targetBranch: z.preprocess(
    (value) => (value === null ? undefined : value),
    gitTargetBranchSchema.optional(),
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
