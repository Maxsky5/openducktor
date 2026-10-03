import { z } from "zod";
import { agentModelDefaultSchema, repoAgentDefaultsSchema } from "./config-schemas";
import { azureDevOpsConnectionStateSchema } from "./azure-devops-schemas";
import {
  gitProviderConfigSchema,
  gitProviderHealthSchema,
  workspaceRecordSchema,
} from "./git-schemas";

export const workspaceProviderSetupSelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("incomplete"), providerId: z.enum(["github", "azure_devops"]) }),
  z.strictObject({
    kind: z.literal("configured"),
    config: gitProviderConfigSchema.refine(
      (config) => config.id === "github" || config.id === "azure_devops",
      "Choose GitHub or Azure DevOps.",
    ),
  }),
]);
export type WorkspaceProviderSetupSelection = z.infer<typeof workspaceProviderSetupSelectionSchema>;
export const workspaceProviderSetupRefSchema = z.strictObject({
  setupId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});
export type WorkspaceProviderSetupRef = z.infer<typeof workspaceProviderSetupRefSchema>;
export const workspaceProviderSetupBeginSchema = z.strictObject({
  repoPath: z.string().trim().min(1),
});
export const workspaceProviderSetupSetSchema = workspaceProviderSetupRefSchema.extend({
  selection: workspaceProviderSetupSelectionSchema,
});
export const workspaceProviderSetupSessionSchema = workspaceProviderSetupRefSchema.extend({
  repoPath: z.string().min(1),
});
export type WorkspaceProviderSetupSession = z.infer<typeof workspaceProviderSetupSessionSchema>;
const candidateSchema = z.strictObject({
  config: gitProviderConfigSchema,
  remoteNames: z.array(z.string()),
});
export const workspaceProviderSetupDetectionSchema = z.strictObject({
  outcome: z.enum(["detected", "ambiguous", "none"]),
  candidates: z.array(candidateSchema),
});
export type WorkspaceProviderSetupDetection = z.infer<typeof workspaceProviderSetupDetectionSchema>;
export const workspaceProviderSetupStatusSchema = z.strictObject({
  health: gitProviderHealthSchema.nullable(),
  connection: azureDevOpsConnectionStateSchema.nullable(),
});
export type WorkspaceProviderSetupStatus = z.infer<typeof workspaceProviderSetupStatusSchema>;
export const workspaceProviderSetupGithubSchema = z.strictObject({
  executablePath: z.string().nullable(),
  version: z.string().nullable(),
  authenticated: z.boolean(),
  account: z.string().nullable(),
  reason: z.string().nullable(),
});
export type WorkspaceProviderSetupGithub = z.infer<typeof workspaceProviderSetupGithubSchema>;
export const workspaceProviderSetupCommitSchema = workspaceProviderSetupRefSchema.extend({
  workspaceId: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  workspaceName: z.string().trim().min(1),
  abbreviation: z.string().optional(),
  tileColor: z.string().optional(),
  defaultModel: agentModelDefaultSchema.optional(),
  agentDefaults: repoAgentDefaultsSchema,
});
export type WorkspaceProviderSetupCommit = z.infer<typeof workspaceProviderSetupCommitSchema>;
export const workspaceProviderSetupProgressSchema = z.strictObject({
  workspace: workspaceRecordSchema.nullable(),
  registrationSaved: z.boolean(),
  settingsSaved: z.boolean(),
  credentialsSaved: z.boolean(),
  phase: z.enum(["validate", "settings", "credentials", "complete"]),
  error: z.string().nullable(),
});
export type WorkspaceProviderSetupProgress = z.infer<typeof workspaceProviderSetupProgressSchema>;
export const workspaceProviderSetupProgressReadSchema = workspaceProviderSetupSessionSchema.extend({
  selection: workspaceProviderSetupSelectionSchema,
  progress: workspaceProviderSetupProgressSchema,
});
