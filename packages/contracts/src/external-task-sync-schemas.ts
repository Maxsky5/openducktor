import { z } from "zod";

export const externalTaskSyncEventKindSchema = z.union([
  z.literal("external_task_created"),
  z.literal("tasks_updated"),
]);
export type ExternalTaskSyncEventKind = z.infer<typeof externalTaskSyncEventKindSchema>;

export const externalTaskCreatedEventSchema = z.object({
  eventId: z.string().min(1),
  kind: z.literal("external_task_created"),
  repoPath: z.string().min(1),
  taskId: z.string().min(1),
  emittedAt: z.string().min(1),
});
export const tasksUpdatedEventSchema = z.object({
  eventId: z.string().min(1),
  kind: z.literal("tasks_updated"),
  repoPath: z.string().min(1),
  taskIds: z.array(z.string().min(1)).min(1),
  emittedAt: z.string().min(1),
});

export const externalTaskSyncEventSchema = z.discriminatedUnion("kind", [
  externalTaskCreatedEventSchema,
  tasksUpdatedEventSchema,
]);
export type ExternalTaskSyncEvent = z.infer<typeof externalTaskSyncEventSchema>;
