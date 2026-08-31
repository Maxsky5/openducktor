import type { GitProviderDescriptor } from "./git-schemas";

export const GITHUB_PROVIDER_DESCRIPTOR = {
  id: "github",
  label: "GitHub",
  description: "GitHub repository hosting and Pull Request integration.",
  capabilities: {
    supportsPullRequests: true,
    supportsPullRequestReview: true,
  },
} as const satisfies GitProviderDescriptor;
