import { z } from "zod";
import { startupStepSchema } from "./session-startup-schemas";
import { workflowFailureSchema } from "./workflow-failure-schemas";
import { workspaceRefSchema } from "./workspace-id-schemas";

export const BACKGROUND_OPERATION_PR_ALREADY_LINKED = "background_operation_pr_already_linked";

export const backgroundOperationIdSchema = z.uuid();

export const backgroundOperationTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("task"), taskId: z.string().trim().min(1) }),
  z.strictObject({ kind: z.literal("chat"), sessionId: z.string().trim().min(1) }),
]);
export type BackgroundOperationTarget = z.infer<typeof backgroundOperationTargetSchema>;

export const backgroundOperationStepSchema = startupStepSchema.pick({
  id: true,
  label: true,
  state: true,
  details: true,
  failure: true,
  resources: true,
});
export type BackgroundOperationStep = z.infer<typeof backgroundOperationStepSchema>;

const snapshot = z.strictObject({
  operationId: backgroundOperationIdSchema,
  hostInstanceId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  workspace: workspaceRefSchema,
  target: backgroundOperationTargetSchema,
  steps: z.array(backgroundOperationStepSchema),
});

export const failedBackgroundOperationSchema = snapshot.extend({
  phase: z.literal("failed"),
  failure: workflowFailureSchema,
});
export const backgroundOperationSnapshotSchema = z.discriminatedUnion("phase", [
  snapshot.extend({ phase: z.enum(["running", "succeeded"]) }),
  failedBackgroundOperationSchema,
]);
export type BackgroundOperationSnapshot = z.infer<typeof backgroundOperationSnapshotSchema>;
export type FailedBackgroundOperation = z.infer<typeof failedBackgroundOperationSchema>;

export const backgroundOperationProgressEventSchema = z.strictObject({
  channel: z.literal("openducktor://background-operation-progress"),
  payload: backgroundOperationSnapshotSchema,
});
export type BackgroundOperationProgressEvent = z.infer<
  typeof backgroundOperationProgressEventSchema
>;
