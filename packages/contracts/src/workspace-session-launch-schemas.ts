import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { agentSessionControlSendInputSchema } from "./agent-session-control-schemas";
import { gitTargetBranchSchema } from "./git-schemas";
import { sessionLaunchResultSchema } from "./session-launch-schemas";
import { agentSessionModelSelectionSchema } from "./session-schemas";
import { startupOperationContextSchema } from "./session-startup-context-schemas";
import { workspaceIdSchema } from "./workspace-id-schemas";
import {
  WORKSPACE_SESSION_UPSTREAM_TARGET_MESSAGE,
  workspaceSessionAllowsTargetBranch,
  workspaceSessionWorktreeInputSchema,
} from "./workspace-session-command-schemas";
import {
  workspaceSessionSchema,
  workspaceSessionWorkingDirectorySchema,
} from "./workspace-session-schemas";

const workspaceSessionLaunchBaseFields = {
  startup: startupOperationContextSchema.optional(),
  workspaceId: workspaceIdSchema,
  repoPath: z.string().min(1),
  draftId: z.string().min(1),
  runtimeKind: runtimeKindSchema,
  selectedModel: agentSessionModelSelectionSchema.nullable(),
  customAgentRoleId: z.string().min(1).nullable(),
  targetBranch: gitTargetBranchSchema,
  parts: agentSessionControlSendInputSchema.shape.parts,
};

export const workspaceSessionLaunchRequestSchema = z
  .discriminatedUnion("location", [
    z.strictObject({
      ...workspaceSessionLaunchBaseFields,
      location: z.literal("local_repo_root"),
    }),
    z.strictObject({
      ...workspaceSessionLaunchBaseFields,
      location: z.literal("local_worktree"),
      worktree: workspaceSessionWorktreeInputSchema,
    }),
    z.strictObject({
      ...workspaceSessionLaunchBaseFields,
      location: z.literal("existing_worktree"),
      existingWorktree: z.strictObject({
        workingDirectory: workspaceSessionWorkingDirectorySchema,
      }),
    }),
  ])
  .refine((input) => workspaceSessionAllowsTargetBranch(input.location, input.targetBranch), {
    path: ["targetBranch"],
    message: WORKSPACE_SESSION_UPSTREAM_TARGET_MESSAGE,
  })
  .refine(
    (input) =>
      input.selectedModel === null || input.selectedModel.runtimeKind === input.runtimeKind,
    {
      path: ["selectedModel", "runtimeKind"],
      message: "Model Runtime must match the Workspace Session Runtime.",
    },
  );
export type WorkspaceSessionLaunchRequest = z.infer<typeof workspaceSessionLaunchRequestSchema>;
export const workspaceSessionLaunchResultSchema = sessionLaunchResultSchema.extend({
  sessionId: z.string().min(1).optional(),
  record: workspaceSessionSchema.optional(),
});
export type WorkspaceSessionLaunchResult = z.infer<typeof workspaceSessionLaunchResultSchema>;
