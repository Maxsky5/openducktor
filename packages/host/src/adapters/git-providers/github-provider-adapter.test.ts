import { describe, expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitProviderResolver } from "../../application/git/git-provider-resolver";
import { createGithubReviewTestDependencies } from "../pull-requests/github/github-pull-request-review.test-support";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { GithubProviderAdapter } from "./github-provider-adapter";

describe("GithubProviderAdapter", () => {
  test("resolves as the configured provider with typed capability access", async () => {
    const github = new GithubProviderAdapter({
      gitPort: createGitPortTestDouble({}),
      githubDependencies: createGithubReviewTestDependencies(() =>
        Effect.die("GitHub command execution is not expected in resolver composition"),
      ),
    });
    const resolver = await Effect.runPromise(createGitProviderResolver([github]));
    const config = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: { provider: { id: "github", enabled: true } },
    });

    const resolved = await Effect.runPromise(resolver.resolve(config));
    const pullRequests = await Effect.runPromise(resolved.pullRequests());
    const pullRequestReview = await Effect.runPromise(resolved.pullRequestReview());

    expect(resolved).toBe(github);
    expect(resolved.getDescriptor()).toBe(GITHUB_PROVIDER_DESCRIPTOR);
    expect(resolved.getDescriptor().capabilities.supportsPullRequests).toBe(true);
    expect(resolved.getDescriptor().capabilities.supportsPullRequestReview).toBe(true);
    expect(pullRequests).toEqual(
      expect.objectContaining({
        findByBranch: expect.any(Function),
        getByNumber: expect.any(Function),
        upsert: expect.any(Function),
      }),
    );
    expect(pullRequestReview.providerId).toBe("github");
  });
});
