import { z } from "zod";
import { workspaceRecordSchema } from "./git-schemas";

export const workspaceCatalogSchema = z.object({
  openWorkspaces: z.array(workspaceRecordSchema),
  closedWorkspaces: z.array(workspaceRecordSchema),
  onboardingCompleted: z.boolean(),
});
export type WorkspaceCatalog = z.infer<typeof workspaceCatalogSchema>;

export const workspacePathResolutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({ kind: z.literal("open"), workspace: workspaceRecordSchema }),
  z.object({ kind: z.literal("closed"), workspace: workspaceRecordSchema }),
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
