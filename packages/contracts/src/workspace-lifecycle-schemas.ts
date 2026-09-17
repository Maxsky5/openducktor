import { z } from "zod";
import { workspaceRecordSchema } from "./git-schemas";

const requiredWorkspaceInputStringSchema = z.string().trim().min(1);

export const workspaceLifecycleTargetInputSchema = z.object({
  workspaceId: requiredWorkspaceInputStringSchema,
  expectedRepoPath: requiredWorkspaceInputStringSchema,
});
export type WorkspaceLifecycleTargetInput = z.infer<typeof workspaceLifecycleTargetInputSchema>;

export const workspaceRemovalInputSchema = workspaceLifecycleTargetInputSchema.extend({
  removeTaskWorktrees: z.boolean(),
});
export type WorkspaceRemovalInput = z.infer<typeof workspaceRemovalInputSchema>;

export const workspaceResolvePathInputSchema = z.object({
  repoPath: requiredWorkspaceInputStringSchema,
});
export type WorkspaceResolvePathInput = z.infer<typeof workspaceResolvePathInputSchema>;

export const workspaceRemovalPhaseSchema = z.enum(["worktrees", "attachments", "task_store"]);
export type WorkspaceRemovalPhase = z.infer<typeof workspaceRemovalPhaseSchema>;

export const workspaceRemovalRecordSchema = z.object({
  removeTaskWorktrees: z.boolean(),
  phase: workspaceRemovalPhaseSchema,
  pendingWorktreePath: z.string().nullable().default(null),
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
