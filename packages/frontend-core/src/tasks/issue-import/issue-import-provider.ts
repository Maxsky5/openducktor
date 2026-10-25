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

/**
 * Whether a workspace can import tasks now. A failed provider read is not missing setup: only a
 * read that finds an incomplete setup sends the user to Settings.
 */
export type IssueImportState =
  | { kind: "loading" }
  | { kind: "read_failed"; reason: string }
  | { kind: "setup_missing"; reason: string }
  | { kind: "ready"; provider: IssueImportProvider };

export const toIssueImportState = (
  provider: RepositoryGitProviderContext | undefined,
  providerError: Error | null,
): IssueImportState => {
  if (providerError) {
    return {
      kind: "read_failed",
      reason: `Could not read the Git provider. ${providerError.message}`,
    };
  }
  if (provider === undefined) return { kind: "loading" };
  const importProvider = issueImportProvider(provider);
  return importProvider
    ? { kind: "ready", provider: importProvider }
    : { kind: "setup_missing", reason: "Set up a Git provider with issue access in Settings." };
};

export const issueImportActionLabel = (state: IssueImportState): string =>
  state.kind === "ready"
    ? `Import tasks from ${issueImportSourceLabel(state.provider.config.id)}`
    : "Import tasks from the Git provider";

/**
 * Why the import action cannot run, or null when it can. Missing setup can run: it opens
 * Settings. A loading or failed provider read cannot.
 */
export const issueImportBlockedReason = (state: IssueImportState): string | null => {
  if (state.kind === "loading") return "Loading the Git provider…";
  if (state.kind === "read_failed") return state.reason;
  return null;
};

/** Why the import action cannot import now, or undefined when it can. */
export const issueImportActionHint = (state: IssueImportState): string | undefined =>
  state.kind === "setup_missing" ? state.reason : (issueImportBlockedReason(state) ?? undefined);

/** Open the import of a ready provider, or Settings for missing setup. Other states do nothing. */
export const runIssueImport = (
  state: IssueImportState,
  handlers: { openImport: (provider: IssueImportProvider) => void; openSettings: () => void },
): void => {
  if (state.kind === "ready") handlers.openImport(state.provider);
  else if (state.kind === "setup_missing") handlers.openSettings();
};
