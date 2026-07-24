import { z } from "zod";

export const externalTaskSyncEventKindSchema = z.union([
  z.literal("external_task_created"),
  z.literal("tasks_updated"),
]);
export type ExternalTaskSyncEventKind = z.infer<typeof externalTaskSyncEventKindSchema>;

const strictTaskEventValueSchema = z
  .string()
  .min(1, "Task event values must not be empty.")
  .refine((value) => value === value.trim(), {
    message: "Task event values must not include leading or trailing whitespace.",
  });

export const externalTaskCreatedEventSchema = z.object({
  eventId: strictTaskEventValueSchema,
  kind: z.literal("external_task_created"),
  repoPath: strictTaskEventValueSchema,
  taskId: strictTaskEventValueSchema,
  emittedAt: z.string().min(1),
});

const taskChangeIdSchema = strictTaskEventValueSchema;
const uniqueTaskChangeIdsSchema = z
  .array(taskChangeIdSchema)
  .refine((taskIds) => new Set(taskIds).size === taskIds.length, {
    message: "Task IDs must be unique.",
  });

export const taskChangeSetSchema = z
  .object({
    taskIds: uniqueTaskChangeIdsSchema.min(1),
    removedTaskIds: uniqueTaskChangeIdsSchema,
  })
  .superRefine(({ taskIds, removedTaskIds }, context) => {
    const taskIdSet = new Set(taskIds);
    for (const removedTaskId of removedTaskIds) {
      if (!taskIdSet.has(removedTaskId)) {
        context.addIssue({
          code: "custom",
          message: "Removed task IDs must be included in task IDs.",
          path: ["removedTaskIds"],
        });
      }
    }
  });
export type TaskChangeSet = z.infer<typeof taskChangeSetSchema>;

export const tasksUpdatedEventSchema = taskChangeSetSchema.extend({
  eventId: strictTaskEventValueSchema,
  kind: z.literal("tasks_updated"),
  repoPath: strictTaskEventValueSchema,
  emittedAt: z.string().min(1),
});

export const externalTaskSyncEventSchema = z.discriminatedUnion("kind", [
  externalTaskCreatedEventSchema,
  tasksUpdatedEventSchema,
]);
export type ExternalTaskSyncEvent = z.infer<typeof externalTaskSyncEventSchema>;

export const taskEventCursorSchema = z
  .object({
    epoch: z.string().uuid(),
    sequence: z.number().int().min(0),
  })
  .strict();
export type TaskEventCursor = z.infer<typeof taskEventCursorSchema>;

export const taskEventChangeFrameSchema = z
  .object({
    type: z.literal("change"),
    cursor: taskEventCursorSchema,
    event: externalTaskSyncEventSchema,
  })
  .strict();
export type TaskEventChangeFrame = z.infer<typeof taskEventChangeFrameSchema>;

export const taskEventSnapshotRequiredReasonSchema = z.enum(["epoch_mismatch", "buffer_gap"]);
export type TaskEventSnapshotRequiredReason = z.infer<typeof taskEventSnapshotRequiredReasonSchema>;

export const taskEventSnapshotRequiredFrameSchema = z
  .object({
    type: z.literal("snapshot_required"),
    cursor: taskEventCursorSchema,
    reason: taskEventSnapshotRequiredReasonSchema,
  })
  .strict();
export type TaskEventSnapshotRequiredFrame = z.infer<typeof taskEventSnapshotRequiredFrameSchema>;

export const taskEventStreamFrameSchema = z.discriminatedUnion("type", [
  taskEventChangeFrameSchema,
  taskEventSnapshotRequiredFrameSchema,
]);
export type TaskEventStreamFrame = z.infer<typeof taskEventStreamFrameSchema>;

export const taskEventStreamSubscribeSchema = z
  .object({
    cursor: taskEventCursorSchema.nullable(),
  })
  .strict();
export type TaskEventStreamSubscribe = z.infer<typeof taskEventStreamSubscribeSchema>;

export const taskEventStreamAcknowledgeSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    cursor: taskEventCursorSchema,
  })
  .strict();
export type TaskEventStreamAcknowledge = z.infer<typeof taskEventStreamAcknowledgeSchema>;
