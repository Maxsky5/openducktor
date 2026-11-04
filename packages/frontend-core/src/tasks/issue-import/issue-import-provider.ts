import type { KnownGitProviderId, RepositoryGitProviderContext } from "@openducktor/contracts";
import { isKnownGitProviderId } from "../../git/git-provider-label";

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

/** The import copy of a Git provider: its items, and its search field when it can search. */
export type IssueImportProviderCopy = {
  sourceLabel: string;
  search: { label: string; placeholder: string };
};

const ISSUE_SEARCH = {
  label: "Search issues",
  placeholder: "Search titles or issue numbers",
} as const;

const ISSUE_IMPORT_PROVIDER_COPY = {
  github: { sourceLabel: "GitHub Issues", search: ISSUE_SEARCH },
  gitlab: { sourceLabel: "GitLab issues", search: ISSUE_SEARCH },
  azure_devops: {
    sourceLabel: "Azure DevOps work items",
    search: { label: "Search work items", placeholder: "Search titles" },
  },
} as const satisfies Record<KnownGitProviderId, IssueImportProviderCopy>;

/** The import copy of a provider. An unknown provider shows its ID and issue wording. */
export const issueImportProviderCopy = (providerId: string): IssueImportProviderCopy =>
  isKnownGitProviderId(providerId)
    ? ISSUE_IMPORT_PROVIDER_COPY[providerId]
    : { sourceLabel: `${providerId} issues`, search: ISSUE_SEARCH };

/** The name of the items that a Git provider imports as tasks. */
export const issueImportSourceLabel = (providerId: string): string =>
  issueImportProviderCopy(providerId).sourceLabel;

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
