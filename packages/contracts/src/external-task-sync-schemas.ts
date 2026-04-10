import { z } from "zod";

export const externalTaskSyncEventKindSchema = z.literal("external_task_created");
export type ExternalTaskSyncEventKind = z.infer<typeof externalTaskSyncEventKindSchema>;

export const externalTaskSyncEventSchema = z.object({
  eventId: z.string().min(1),
  kind: externalTaskSyncEventKindSchema,
  repoPath: z.string().min(1),
  taskId: z.string().min(1),
  emittedAt: z.string().min(1),
});
export type ExternalTaskSyncEvent = z.infer<typeof externalTaskSyncEventSchema>;
