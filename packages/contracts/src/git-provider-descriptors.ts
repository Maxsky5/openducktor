import type { GitProviderDescriptor, KnownGitProviderId } from "./git-schemas";

export const GITHUB_PROVIDER_DESCRIPTOR = {
  id: "github",
  label: "GitHub",
  description: "GitHub repository hosting and Pull Request integration.",
  capabilities: {
    supportsPullRequests: true,
    supportsPullRequestReview: true,
    issueAccess: "search",
  },
} as const satisfies GitProviderDescriptor;

export const GITLAB_PROVIDER_DESCRIPTOR = {
  id: "gitlab",
  label: "GitLab",
  description: "GitLab merge request, CI, and issue integration.",
  capabilities: {
    supportsPullRequests: true,
    supportsPullRequestReview: true,
    issueAccess: "search",
  },
} as const satisfies GitProviderDescriptor;

export const AZURE_DEVOPS_PROVIDER_DESCRIPTOR = {
  id: "azure_devops",
  label: "Azure DevOps",
  description: "Azure Repos pull request and review integration.",
  capabilities: {
    supportsPullRequests: true,
    supportsPullRequestReview: true,
    issueAccess: "search",
  },
} as const satisfies GitProviderDescriptor;

/** The descriptor of each known provider. Use it for every provider label. */
export const KNOWN_GIT_PROVIDER_DESCRIPTORS = {
  github: GITHUB_PROVIDER_DESCRIPTOR,
  azure_devops: AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  gitlab: GITLAB_PROVIDER_DESCRIPTOR,
} as const satisfies Record<KnownGitProviderId, GitProviderDescriptor>;
