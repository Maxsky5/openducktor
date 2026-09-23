import type { GitProviderDescriptor } from "./git-schemas";

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
