import { z } from "zod";
import { startupOperationContextSchema } from "./session-startup-context-schemas";
import { startupOperationSnapshotSchema } from "./session-startup-schemas";
import { agentSessionControlSummarySchema } from "./agent-session-summary-schemas";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { workspaceIdSchema } from "./workspace-id-schemas";
import { type GitTargetBranch, gitTargetBranchSchema, UPSTREAM_TARGET_BRANCH } from "./git-schemas";
import { agentSessionModelSelectionSchema } from "./session-schemas";
import { agentSessionForkPointSchema } from "./agent-session-schemas";
import {
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  workspaceSessionSchema,
  workspaceSessionWorkingDirectorySchema,
} from "./workspace-session-schemas";
import {
  workspaceSessionListInputSchema,
  workspaceSessionRefInputSchema,
} from "./workspace-session-ref-schemas";

export {
  type WorkspaceSessionRefInput,
  workspaceSessionListInputSchema,
  workspaceSessionRefInputSchema,
} from "./workspace-session-ref-schemas";

export const workspaceSessionWorktreeNameSchema = z
  .string()
  .trim()
  .transform((name) => name.replace(/[\s/\\]+/g, "-"))
  .pipe(
    z
      .string()
      .min(1)
      .max(80)
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
        "Use letters, numbers, hyphens, or underscores, starting with a letter or number.",
      ),
  );

export const workspaceSessionBranchNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (name) =>
      name !== "HEAD" &&
      name !== "@" &&
      !name.startsWith("-") &&
      !name.endsWith(".") &&
      !name.includes("..") &&
      !name.includes("@{") &&
      !Array.from(name).some(
        (character) =>
          character.charCodeAt(0) <= 32 ||
          character.charCodeAt(0) === 127 ||
          "~^:?*[\\".includes(character),
      ) &&
      name
        .split("/")
        .every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock")),
    "Enter a valid Git branch name.",
  );

export const workspaceSessionWorktreeInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("from_branch"),
    name: workspaceSessionWorktreeNameSchema,
    branchName: workspaceSessionBranchNameSchema,
  }),
  z.strictObject({
    mode: z.literal("from_name"),
    name: workspaceSessionWorktreeNameSchema,
    branchName: workspaceSessionBranchNameSchema.nullable(),
  }),
]);
export type WorkspaceSessionWorktreeInput = z.infer<typeof workspaceSessionWorktreeInputSchema>;

export const WORKSPACE_SESSION_UPSTREAM_TARGET_MESSAGE =
  "Tracked upstream is available only for the current checkout.";

const workspaceSessionCreateFields = {
  startup: startupOperationContextSchema.optional(),
  workspaceId: workspaceIdSchema,
  runtimeKind: runtimeKindSchema,
  selectedModel: agentSessionModelSelectionSchema.nullable(),
  customAgentRoleId: z.string().min(1).nullable(),
  manualTitle: z.string().nullable(),
  targetBranch: gitTargetBranchSchema,
};

const workspaceSessionCreateLocationsSchema = z.discriminatedUnion("location", [
  z.strictObject({
    ...workspaceSessionCreateFields,
    location: z.literal("local_repo_root"),
  }),
  z.strictObject({
    ...workspaceSessionCreateFields,
    location: z.literal("local_worktree"),
    worktree: workspaceSessionWorktreeInputSchema,
  }),
  z.strictObject({
    ...workspaceSessionCreateFields,
    location: z.literal("existing_worktree"),
    existingWorktree: z.strictObject({
      workingDirectory: workspaceSessionWorkingDirectorySchema,
    }),
  }),
]);

/** A creation location. An existing worktree saves the same target kind as a new worktree. */
export type WorkspaceSessionLocation = z.infer<
  typeof workspaceSessionCreateLocationsSchema
>["location"];

/** Tracked upstream needs the current checkout. A worktree chat needs an explicit branch. */
export const workspaceSessionAllowsTargetBranch = (
  location: WorkspaceSessionLocation,
  targetBranch: GitTargetBranch,
): boolean => location === "local_repo_root" || targetBranch.branch !== UPSTREAM_TARGET_BRANCH;

/**
 * The target that a chat uses. A chat without a saved target follows the repository default.
 * The result is null when the chat location cannot use that default.
 */
export const effectiveWorkspaceSessionTargetBranch = (
  location: WorkspaceSessionLocation,
  savedTarget: GitTargetBranch | null,
  repoDefault: GitTargetBranch | null,
): GitTargetBranch | null => {
  if (savedTarget) return savedTarget;
  return repoDefault && workspaceSessionAllowsTargetBranch(location, repoDefault)
    ? repoDefault
    : null;
};

export const workspaceSessionCreateInputSchema = workspaceSessionCreateLocationsSchema
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
export type WorkspaceSessionCreateInput = z.infer<typeof workspaceSessionCreateInputSchema>;

export const workspaceSessionCreateResultSchema = z.strictObject({
  session: workspaceSessionSchema,
  startupProgress: startupOperationSnapshotSchema.optional(),
});
export type WorkspaceSessionCreateResult = z.infer<typeof workspaceSessionCreateResultSchema>;

/** Registered worktrees that a new chat can use. A null branch means detached HEAD. */
export const workspaceSessionWorktreesListResultSchema = z.strictObject({
  worktrees: z.array(
    z.strictObject({
      workingDirectory: workspaceSessionWorkingDirectorySchema,
      branchName: z.string().min(1).nullable(),
    }),
  ),
});
export type WorkspaceSessionWorktreesListResult = z.infer<
  typeof workspaceSessionWorktreesListResultSchema
>;

export const workspaceSessionStartInputSchema = workspaceSessionRefInputSchema.extend({
  startup: startupOperationContextSchema.optional(),
});
export type WorkspaceSessionStartInput = z.infer<typeof workspaceSessionStartInputSchema>;

export const workspaceSessionStartResultSchema = z.strictObject({
  session: workspaceSessionSchema,
  runtimeSession: agentSessionControlSummarySchema.nullable(),
  startupProgress: startupOperationSnapshotSchema.optional(),
});
export type WorkspaceSessionStartResult = z.infer<typeof workspaceSessionStartResultSchema>;

export const workspaceSessionForkInputSchema = workspaceSessionRefInputSchema.extend({
  startup: startupOperationContextSchema.optional(),
  forkPoint: agentSessionForkPointSchema,
  destination: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("same_folder") }),
    z.strictObject({
      kind: z.literal("new_worktree"),
      name: workspaceSessionWorktreeNameSchema,
      branchName: workspaceSessionBranchNameSchema,
    }),
  ]),
});
export type WorkspaceSessionForkInput = z.infer<typeof workspaceSessionForkInputSchema>;

export const workspaceSessionForkResultSchema = z.strictObject({
  record: workspaceSessionSchema,
  runtimeSession: agentSessionControlSummarySchema,
  syncWarning: z.string().trim().min(1).optional(),
  startupProgress: startupOperationSnapshotSchema.optional(),
});
export type WorkspaceSessionForkResult = z.infer<typeof workspaceSessionForkResultSchema>;

export const workspaceSessionSetDraftModelInputSchema = workspaceSessionRefInputSchema.extend({
  selectedModel: agentSessionModelSelectionSchema,
});

export const workspaceSessionSetTargetBranchInputSchema = workspaceSessionRefInputSchema.extend({
  targetBranch: gitTargetBranchSchema,
});
export type WorkspaceSessionSetTargetBranchInput = z.infer<
  typeof workspaceSessionSetTargetBranchInputSchema
>;

export const workspaceSessionRenameInputSchema = workspaceSessionRefInputSchema.extend({
  manualTitle: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().max(WORKSPACE_SESSION_MANUAL_TITLE_LIMIT))
    .nullable(),
});
export const workspaceSessionArchiveInputSchema = workspaceSessionRefInputSchema.extend({
  confirmStop: z.boolean().default(false),
  removeWorktree: z.boolean().default(false),
  worktreeConfirmation: z
    .strictObject({ workingDirectory: z.string().min(1), branchName: z.string().min(1) })
    .optional(),
});
export type WorkspaceSessionArchiveInput = z.infer<typeof workspaceSessionArchiveInputSchema>;

export const workspaceSessionExternalSchema = z.strictObject({
  externalSessionId: z.string().min(1),
  runtimeKind: runtimeKindSchema,
  workingDirectory: z.string().min(1),
  title: z.string().nullable(),
  updatedAt: z.number().int().nullable(),
});
export type WorkspaceSessionExternal = z.infer<typeof workspaceSessionExternalSchema>;
export const workspaceSessionExternalReleaseInputSchema = workspaceSessionListInputSchema.extend({
  catalogRequestId: z.string().uuid(),
});
export const workspaceSessionExternalListInputSchema =
  workspaceSessionExternalReleaseInputSchema.extend({
    runtimeKind: runtimeKindSchema,
    search: z.string().max(1000).default(""),
    cursor: z.string().max(200).optional(),
    pageSize: z.number().int().min(1).max(100).default(50),
  });
export type WorkspaceSessionExternalListInput = z.infer<
  typeof workspaceSessionExternalListInputSchema
>;
export const workspaceSessionExternalListResultSchema = z.strictObject({
  catalogId: z.string(),
  sessions: z.array(workspaceSessionExternalSchema),
  nextCursor: z.string().nullable(),
});
export type WorkspaceSessionExternalListResult = z.infer<
  typeof workspaceSessionExternalListResultSchema
>;
export const workspaceSessionImportInputSchema = workspaceSessionListInputSchema.extend({
  catalogRequestId: z.string().uuid(),
  runtimeKind: runtimeKindSchema,
  externalSessionId: z.string().min(1),
  workingDirectory: z.string().min(1),
});
export type WorkspaceSessionImportInput = z.infer<typeof workspaceSessionImportInputSchema>;
export const workspaceSessionImportResultSchema = z.strictObject({
  session: workspaceSessionSchema,
  created: z.boolean(),
  openError: z.string().nullable(),
});
export type WorkspaceSessionImportResult = z.infer<typeof workspaceSessionImportResultSchema>;
