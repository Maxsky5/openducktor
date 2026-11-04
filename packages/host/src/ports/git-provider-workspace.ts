import type { RepoConfig } from "@openducktor/contracts";

/** The workspace fields that a Git provider reads. A provider never reads other settings. */
export type GitProviderWorkspace = Pick<RepoConfig, "workspaceId" | "repoPath" | "git">;
