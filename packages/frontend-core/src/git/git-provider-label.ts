import {
  KNOWN_GIT_PROVIDER_DESCRIPTORS,
  type KnownGitProviderId,
  type SourceIssueReference,
} from "@openducktor/contracts";

export const isKnownGitProviderId = (providerId: string): providerId is KnownGitProviderId =>
  Object.hasOwn(KNOWN_GIT_PROVIDER_DESCRIPTORS, providerId);

/** The name of a Git provider, such as "GitLab". An unknown provider shows its ID. */
export const gitProviderLabel = (providerId: string): string =>
  isKnownGitProviderId(providerId) ? KNOWN_GIT_PROVIDER_DESCRIPTORS[providerId].label : providerId;

/** The short name of the provider item that a task came from, such as "GitLab #12". */
export const sourceIssueLabel = (
  sourceIssue: Pick<SourceIssueReference, "providerId" | "number">,
): string => `${gitProviderLabel(sourceIssue.providerId)} #${sourceIssue.number}`;
