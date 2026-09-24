import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { agentSessionModelSelectionSchema } from "./session-schemas";
import { WORKSPACE_SESSION_GENERATED_TITLE_LIMIT } from "./workspace-session-limits";

export {
  WORKSPACE_SESSION_ARCHIVE_LIMIT,
  WORKSPACE_SESSION_GENERATED_TITLE_LIMIT,
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
} from "./workspace-session-limits";

const identitySchema = z.string().min(1);
const workingDirectorySchema = z.string().regex(/^(?:\/|[a-zA-Z]:[\\/]|\\\\)/, {
  message: "Execution Target must have an absolute working directory.",
});

export const workspaceSessionExecutionTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("local_repo_root"), workingDirectory: workingDirectorySchema }),
  z
    .strictObject({
      kind: z.literal("local_worktree"),
      workingDirectory: workingDirectorySchema,
      branchName: identitySchema.nullable(),
      worktreeState: z.enum(["present", "removed"]),
    })
    .refine((target) => target.worktreeState !== "removed" || target.branchName !== null, {
      message: "A removed worktree must retain its branch name.",
      path: ["branchName"],
    }),
]);
export type WorkspaceSessionExecutionTarget = z.infer<typeof workspaceSessionExecutionTargetSchema>;

export const workspaceSessionArchivePreviewSchema = z.strictObject({
  branchName: identitySchema.nullable(),
  worktreeExists: z.boolean(),
  hasUncommittedChanges: z.boolean(),
});
export type WorkspaceSessionArchivePreview = z.infer<typeof workspaceSessionArchivePreviewSchema>;

export const customAgentRoleInputSchema = z.strictObject({
  name: z.string().trim().min(1),
  systemPrompt: z.string().min(1),
});
export type CustomAgentRoleInput = z.infer<typeof customAgentRoleInputSchema>;

export const customAgentRoleSchema = customAgentRoleInputSchema.extend({ id: identitySchema });
export type CustomAgentRole = z.infer<typeof customAgentRoleSchema>;

export const workspaceSessionRoleSnapshotSchema = customAgentRoleSchema;
export type WorkspaceSessionRoleSnapshot = z.infer<typeof workspaceSessionRoleSnapshotSchema>;

export const workspaceSessionGeneratedTitleSchema = z
  .string()
  .min(1)
  .max(WORKSPACE_SESSION_GENERATED_TITLE_LIMIT);

export const workspaceSessionSchema = z
  .strictObject({
    id: identitySchema,
    runtimeKind: runtimeKindSchema,
    externalSessionId: identitySchema.nullable(),
    executionTarget: workspaceSessionExecutionTargetSchema,
    roleSnapshot: workspaceSessionRoleSnapshotSchema.nullable(),
    selectedModel: agentSessionModelSelectionSchema.nullable(),
    generatedTitle: workspaceSessionGeneratedTitleSchema.nullable(),
    manualTitle: z.string().min(1).nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    archivedAt: z.number().int().nullable(),
  })
  .refine(
    (session) =>
      session.selectedModel === null || session.selectedModel.runtimeKind === session.runtimeKind,
    {
      path: ["selectedModel", "runtimeKind"],
      message: "Model Runtime must match the Workspace Session Runtime.",
    },
  );
export type WorkspaceSession = z.infer<typeof workspaceSessionSchema>;

export const workspaceSessionActivitySchema = z.strictObject({
  type: z.enum(["user_message", "assistant_response"]),
  occurredAt: z.number().int(),
});
export type WorkspaceSessionActivity = z.infer<typeof workspaceSessionActivitySchema>;
