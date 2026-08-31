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
    expect(resolved.repository()).toEqual(
      expect.objectContaining({
        getReadRepository: expect.any(Function),
        getWriteContext: expect.any(Function),
      }),
    );
    expect(resolved.health()).toEqual(
      expect.objectContaining({
        getStatus: expect.any(Function),
      }),
    );
    expect(pullRequests).toEqual(
      expect.objectContaining({
        findByBranch: expect.any(Function),
        getByNumber: expect.any(Function),
        upsert: expect.any(Function),
      }),
    );
    expect(pullRequestReview.providerId).toBe("github");
  });

  test("reads pull requests without requiring a write remote", async () => {
    const gitPort = createGitPortTestDouble({
      listRemotes: () =>
        Effect.succeed([
          { name: "origin", url: "https://github.com/Maxsky5/openducktor.git" },
          { name: "upstream", url: "https://github.com/Maxsky5/openducktor.git" },
        ]),
    });
    const githubDependencies = createGithubReviewTestDependencies((_command, args) => {
      if (args[0] === "auth") {
        return Effect.succeed({ ok: true, stdout: "", stderr: "" });
      }
      if (args.some((arg) => arg.endsWith("/pulls/42"))) {
        return Effect.succeed({
          ok: true,
          stdout: JSON.stringify({
            number: 42,
            html_url: "https://github.com/Maxsky5/openducktor/pull/42",
            state: "open",
            draft: false,
            created_at: "2026-08-31T10:00:00Z",
            updated_at: "2026-08-31T11:00:00Z",
            merged_at: null,
            closed_at: null,
            head: { ref: "odt/task-42" },
            base: { ref: "main" },
          }),
          stderr: "",
        });
      }
      return Effect.succeed({ ok: true, stdout: "[]", stderr: "" });
    });
    const github = new GithubProviderAdapter({ githubDependencies, gitPort });
    const pullRequests = await Effect.runPromise(github.pullRequests());
    const repoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: {
        provider: {
          id: "github",
          enabled: true,
          repository: { host: "github.com", owner: "Maxsky5", name: "openducktor" },
        },
      },
    });

    const byBranch = await Effect.runPromise(
      pullRequests.findByBranch({ repoConfig, sourceBranch: "odt/task-42", state: "open" }),
    );
    const byNumber = await Effect.runPromise(pullRequests.getByNumber({ repoConfig, number: 42 }));

    expect(byBranch).toBeUndefined();
    expect(byNumber.number).toBe(42);
  });
});
