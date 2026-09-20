import { z } from "zod";
import { agentSessionControlSummarySchema } from "./agent-session-control-schemas";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { workspaceIdSchema } from "./config-schemas";
import { agentSessionModelSelectionSchema } from "./session-schemas";
import {
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  workspaceSessionSchema,
} from "./workspace-session-schemas";

export const workspaceSessionListInputSchema = z.strictObject({ workspaceId: workspaceIdSchema });
export const workspaceSessionRefInputSchema = workspaceSessionListInputSchema.extend({
  sessionId: z.string().min(1),
});
export type WorkspaceSessionRefInput = z.infer<typeof workspaceSessionRefInputSchema>;

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

export const workspaceSessionCreateInputSchema = z
  .strictObject({
    workspaceId: workspaceIdSchema,
    runtimeKind: runtimeKindSchema,
    selectedModel: agentSessionModelSelectionSchema.nullable(),
    customAgentRoleId: z.string().min(1).nullable(),
    location: z.enum(["local_repo_root", "local_worktree"]),
    worktree: workspaceSessionWorktreeInputSchema.optional(),
    manualTitle: z.string().nullable(),
  })
  .refine((input) => (input.location === "local_worktree") === (input.worktree !== undefined), {
    path: ["worktree"],
    message: "Worktree options are required only for a new worktree.",
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
});
export type WorkspaceSessionCreateResult = z.infer<typeof workspaceSessionCreateResultSchema>;

export const workspaceSessionStartResultSchema = z.strictObject({
  session: workspaceSessionSchema,
  runtimeSession: agentSessionControlSummarySchema.nullable(),
});
export type WorkspaceSessionStartResult = z.infer<typeof workspaceSessionStartResultSchema>;

export const workspaceSessionSetDraftModelInputSchema = workspaceSessionRefInputSchema.extend({
  selectedModel: agentSessionModelSelectionSchema,
});

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
