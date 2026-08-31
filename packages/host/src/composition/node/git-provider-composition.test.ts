import { expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGithubReviewTestCommands } from "../../adapters/pull-requests/github/github-pull-request-review.test-support";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { createNodeGitProviderResolver } from "./git-provider-composition";

test("node composition registers the GitHub provider", async () => {
  const githubCommands = createGithubReviewTestCommands(() =>
    Effect.die("GitHub command execution is not expected in composition tests"),
  );
  const resolver = await Effect.runPromise(
    createNodeGitProviderResolver({
      gitPort: createGitPortTestDouble({}),
      githubCommands,
    }),
  );
  const repoConfig = repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultRuntimeKind: "opencode",
    git: { provider: { id: "github", enabled: true } },
  });

  const resolved = await Effect.runPromise(resolver.resolve(repoConfig));

  expect(resolved.getDescriptor()).toBe(GITHUB_PROVIDER_DESCRIPTOR);
});
