import type { RepositoryGitProviderContext } from "@openducktor/contracts";

export type IssueImportProvider = NonNullable<RepositoryGitProviderContext>;

/** The Git provider when its setup can import issues, or null when the setup is incomplete. */
export const issueImportProvider = (
  provider: RepositoryGitProviderContext | undefined,
): IssueImportProvider | null =>
  provider?.config.enabled === true &&
  provider.config.repository !== undefined &&
  provider.descriptor.capabilities.issueAccess !== undefined
    ? provider
    : null;

/** The name of the items that a Git provider imports as tasks. */
export const issueImportSourceLabel = (providerId: string): string =>
  providerId === "github" ? "GitHub Issues" : "Azure DevOps work items";
