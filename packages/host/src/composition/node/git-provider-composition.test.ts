import { expect, test } from "bun:test";
import { repoConfigSchema, type GitProviderDescriptor } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
  PullRequestProviderPort,
} from "../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";
import { createNodeGitProviderResolver } from "./git-provider-composition";

const unexpectedPortCall = <Success>(): Effect.Effect<Success, never> =>
  Effect.die("Provider operation is not expected in composition tests");

const descriptor: GitProviderDescriptor = {
  id: "github",
  label: "GitHub",
  description: "GitHub provider",
  capabilities: {
    supportsPullRequests: true,
    supportsPullRequestReview: true,
  },
};

const repositoryPort: GitProviderRepositoryPort = {
  getReadRepository: () => unexpectedPortCall(),
  getWriteContext: () => unexpectedPortCall(),
};

const healthPort: GitProviderHealthPort = {
  getStatus: () => unexpectedPortCall(),
};

const pullRequestPort: PullRequestProviderPort = {
  findByBranch: () => unexpectedPortCall(),
  getByNumber: () => unexpectedPortCall(),
  upsert: () => unexpectedPortCall(),
};

const reviewPort: PullRequestReviewProviderPort = {
  providerId: "github",
  readContext: () => unexpectedPortCall(),
};

const asyncProvider: GitProviderPort = {
  getDescriptor: () => descriptor,
  repository: () => repositoryPort,
  health: () => healthPort,
  pullRequests: () => Effect.promise(() => Promise.resolve(pullRequestPort)),
  pullRequestReview: () => Effect.promise(() => Promise.resolve(reviewPort)),
};

test("node composition accepts asynchronous capability registrations", async () => {
  const resolver = await Effect.runPromise(createNodeGitProviderResolver([asyncProvider]));
  const repoConfig = repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultRuntimeKind: "opencode",
    git: { provider: { id: "github", enabled: true } },
  });

  const resolved = await Effect.runPromise(resolver.resolve(repoConfig));

  expect(resolved).toBe(asyncProvider);
});
