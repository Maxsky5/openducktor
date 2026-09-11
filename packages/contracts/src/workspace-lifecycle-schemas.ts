import { z } from "zod";
import { workspaceRecordSchema } from "./git-schemas";

export const workspaceRemovalPhaseSchema = z.enum(["worktrees", "attachments", "task_store"]);
export type WorkspaceRemovalPhase = z.infer<typeof workspaceRemovalPhaseSchema>;

export const workspaceRemovalRecordSchema = z.object({
  version: z.literal(1),
  operationId: z.string().min(1),
  removeTaskWorktrees: z.boolean(),
  phase: workspaceRemovalPhaseSchema,
  removedWorktrees: z.array(z.string()).default([]),
  startedAt: z.string(),
  lastFailure: z.string().nullable().default(null),
});
export type WorkspaceRemovalRecord = z.infer<typeof workspaceRemovalRecordSchema>;

export const incompleteWorkspaceRemovalSchema = z.object({
  workspace: workspaceRecordSchema,
  record: workspaceRemovalRecordSchema,
});
export type IncompleteWorkspaceRemoval = z.infer<typeof incompleteWorkspaceRemovalSchema>;

export const workspaceCatalogSchema = z.object({
  openWorkspaces: z.array(workspaceRecordSchema),
  closedWorkspaces: z.array(workspaceRecordSchema),
  incompleteRemovals: z.array(incompleteWorkspaceRemovalSchema),
  onboardingCompleted: z.boolean(),
});
export type WorkspaceCatalog = z.infer<typeof workspaceCatalogSchema>;

export const workspacePathResolutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({ kind: z.literal("open"), workspace: workspaceRecordSchema }),
  z.object({ kind: z.literal("closed"), workspace: workspaceRecordSchema }),
  z.object({ kind: z.literal("removing"), removal: incompleteWorkspaceRemovalSchema }),
]);
export type WorkspacePathResolution = z.infer<typeof workspacePathResolutionSchema>;

export const workspaceRemovalResultSchema = z.object({
  removedWorktrees: z.array(z.string()),
});
export type WorkspaceRemovalResult = z.infer<typeof workspaceRemovalResultSchema>;

export const workspaceRemovalCommandResultSchema = workspaceRemovalResultSchema.extend({
  catalog: workspaceCatalogSchema,
});
export type WorkspaceRemovalCommandResult = z.infer<typeof workspaceRemovalCommandResultSchema>;
