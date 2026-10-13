import { z } from "zod";
import { agentRoleSchema } from "./agent-workflow-schemas";
import { taskCardSchema, taskStatusSchema } from "./task-schemas";

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

export const taskEventTaskSnapshotSchema = z
  .object({
    id: strictTaskEventValueSchema,
    title: z.string(),
    status: taskStatusSchema,
  })
  .strict();
export type TaskEventTaskSnapshot = z.infer<typeof taskEventTaskSnapshotSchema>;

export const taskEventStatusChangeSchema = z.strictObject({
  previousStatus: taskStatusSchema,
  task: taskEventTaskSnapshotSchema,
  sourceRole: agentRoleSchema.optional(),
});
export type TaskEventStatusChange = z.infer<typeof taskEventStatusChangeSchema>;

export const taskDocumentSectionSchema = z.enum(["spec", "plan", "qa"]);
export type TaskDocumentSection = z.infer<typeof taskDocumentSectionSchema>;

export const taskDocumentChangeSchema = z.strictObject({
  taskId: taskChangeIdSchema,
  sections: z
    .array(taskDocumentSectionSchema)
    .min(1)
    .refine((sections) => new Set(sections).size === sections.length, {
      message: "Changed document sections must be unique.",
    }),
});
export type TaskDocumentChange = z.infer<typeof taskDocumentChangeSchema>;

const taskBoardChangesSchema = z
  .strictObject({
    cards: z
      .array(taskCardSchema)
      .refine((cards) => new Set(cards.map((card) => card.id)).size === cards.length, {
        message: "Task board cards must have unique IDs.",
      }),
    doneVisibleDays: z.number().int().min(0),
    documentChanges: z
      .array(taskDocumentChangeSchema)
      .refine(
        (changes) => new Set(changes.map((change) => change.taskId)).size === changes.length,
        { message: "Changed document tasks must be unique." },
      ),
  })
  .superRefine(({ cards, documentChanges }, context) => {
    const taskIds = new Set(cards.map((card) => card.id));
    for (const change of documentChanges) {
      if (!taskIds.has(change.taskId))
        context.addIssue({
          code: "custom",
          message: "A changed document must have a board card.",
          path: ["documentChanges"],
        });
    }
  });

export const externalTaskCreatedEventSchema = z
  .object({
    eventId: strictTaskEventValueSchema,
    kind: z.literal("external_task_created"),
    repoPath: strictTaskEventValueSchema,
    taskId: strictTaskEventValueSchema,
    taskSnapshot: taskEventTaskSnapshotSchema,
    boardChanges: taskBoardChangesSchema.nullable(),
    emittedAt: z.iso.datetime(),
  })
  .refine((event) => event.taskId === event.taskSnapshot.id, {
    message: "The created task snapshot must match the task ID.",
    path: ["taskSnapshot", "id"],
  })
  .refine(
    (event) => {
      if (!event.boardChanges) return true;
      const card = event.boardChanges.cards.find((card) => card.id === event.taskId);
      return card?.title === event.taskSnapshot.title && card.status === event.taskSnapshot.status;
    },
    {
      message: "The created board card must match the task snapshot.",
      path: ["boardChanges", "cards"],
    },
  );

const taskEventTaskSnapshotsSchema = z
  .array(taskEventTaskSnapshotSchema)
  .refine((tasks) => new Set(tasks.map((task) => task.id)).size === tasks.length, {
    message: "Task event snapshots must have unique task IDs.",
  });

export const tasksUpdatedEventSchema = taskChangeSetSchema
  .extend({
    eventId: strictTaskEventValueSchema,
    kind: z.literal("tasks_updated"),
    repoPath: strictTaskEventValueSchema,
    taskSnapshots: taskEventTaskSnapshotsSchema,
    statusChanges: z.array(taskEventStatusChangeSchema),
    boardChanges: taskBoardChangesSchema.nullable(),
    emittedAt: z.iso.datetime(),
  })
  .superRefine(
    ({ taskIds, removedTaskIds, taskSnapshots, statusChanges, boardChanges }, context) => {
      const changedTaskIds = new Set(taskIds);
      const removedTaskIdSet = new Set(removedTaskIds);
      const snapshotTaskIds = new Set(taskSnapshots.map((task) => task.id));
      if (boardChanges) {
        const cardsById = new Map(boardChanges.cards.map((card) => [card.id, card]));
        for (const task of taskSnapshots) {
          const card = cardsById.get(task.id);
          if (!card || card.title !== task.title || card.status !== task.status) {
            context.addIssue({
              code: "custom",
              message: "Board cards must match the changed task snapshots.",
              path: ["boardChanges", "cards"],
            });
          }
        }
        if (boardChanges.cards.some((card) => removedTaskIdSet.has(card.id))) {
          context.addIssue({
            code: "custom",
            message: "Board cards must not include removed tasks.",
            path: ["boardChanges", "cards"],
          });
        }
      }

      for (const change of statusChanges) {
        if (!changedTaskIds.has(change.task.id)) {
          context.addIssue({
            code: "custom",
            message: "Task status changes must refer to a changed task ID.",
            path: ["statusChanges"],
          });
        }
      }
      for (const task of taskSnapshots) {
        if (!changedTaskIds.has(task.id) || removedTaskIdSet.has(task.id)) {
          context.addIssue({
            code: "custom",
            message: "Task event snapshots must describe changed tasks that were not removed.",
            path: ["taskSnapshots"],
          });
        }
      }
      for (const taskId of taskIds) {
        if (
          boardChanges !== null &&
          !removedTaskIdSet.has(taskId) &&
          !snapshotTaskIds.has(taskId)
        ) {
          context.addIssue({
            code: "custom",
            message: "Each changed task that was not removed must have a task event snapshot.",
            path: ["taskSnapshots"],
          });
        }
      }
    },
  );

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

// A save receipt belongs to the live host stream, not the stored document.
export const taskDocumentSaveResultSchema = z.object({
  updatedAt: z.iso.datetime(),
  cursor: taskEventCursorSchema,
});
export type TaskDocumentSaveResult = z.infer<typeof taskDocumentSaveResultSchema>;

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

export const taskEventStreamFrameSchema = z.compile(
  z.discriminatedUnion("type", [taskEventChangeFrameSchema, taskEventSnapshotRequiredFrameSchema]),
  { strict: true },
);
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
