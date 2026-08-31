import { describe, expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGithubCliAdapter } from "./github-cli";
import { createGitProviderResolver } from "../../application/git/git-provider-resolver";
import { HostDependencyError } from "../../effect/host-errors";
import { GitProviderRepositoryError } from "../../ports/git-provider-errors";
import type { SystemCommandPort, SystemCommandRunResult } from "../../ports/system-command-port";
import type { GithubCommandDependencies } from "../../application/tasks/support/github-pull-requests";
import { createGithubReviewTestDependencies } from "../pull-requests/github/github-pull-request-review.test-support";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { GithubProviderAdapter } from "./github-provider-adapter";

const repoConfig = (host = "github.com") =>
  repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultRuntimeKind: "opencode",
    git: {
      provider: {
        id: "github",
        enabled: true,
        repository: { host, owner: "Maxsky5", name: "openducktor" },
      },
    },
  });

const createHealthDependencies = ({
  authResult = { ok: true, stdout: "Logged in to github.com account Maxsky5", stderr: "" },
  runAuth,
  version = "gh version 2.95.0",
}: {
  authResult?: SystemCommandRunResult;
  runAuth?: (args: string[]) => SystemCommandRunResult;
  version?: string | null;
} = {}): GithubCommandDependencies => {
  const systemCommands: SystemCommandPort = {
    resolveCommandPath: () => Effect.die("Unexpected resolveCommandPath call"),
    versionCommand: () => Effect.succeed(version),
    runCommandAllowFailure: (_command, args) => Effect.succeed(runAuth?.(args) ?? authResult),
  };
  const githubCli = createGithubCliAdapter(systemCommands);
  return {
    githubCli,
    resolveGithubCommand: () => Effect.succeed({ ghCommand: "gh", githubCli }),
    systemCommands,
    toolDiscovery: {
      discoverTool: () => Effect.die("Unexpected discoverTool call"),
      resolveTool: () => Effect.die("Unexpected resolveTool call"),
      resolveToolPath: () => Effect.die("Unexpected resolveToolPath call"),
      validateToolPath: () => Effect.die("Unexpected validateToolPath call"),
    },
  };
};

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
        getRepository: expect.any(Function),
        getMapping: expect.any(Function),
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

  test("detects one GitHub repository identity across supported remote URL forms", async () => {
    const github = new GithubProviderAdapter({
      githubDependencies: createHealthDependencies(),
      gitPort: createGitPortTestDouble({
        canonicalizePath: () => Effect.succeed("/canonical/repo"),
        isGitRepository: () => Effect.succeed(true),
        listRemotes: () =>
          Effect.succeed([
            { name: "https", url: "https://token@github.com/Maxsky5/openducktor.git" },
            { name: "scp", url: "git@github.com:Maxsky5/openducktor.git" },
            { name: "ssh", url: "ssh://git@github.com/Maxsky5/openducktor.git" },
          ]),
      }),
    });

    await expect(Effect.runPromise(github.repository().detectRepository("/repo"))).resolves.toEqual(
      { host: "github.com", owner: "Maxsky5", name: "openducktor" },
    );
  });

  test("detects GitHub Enterprise repositories", async () => {
    const github = new GithubProviderAdapter({
      githubDependencies: createHealthDependencies(),
      gitPort: createGitPortTestDouble({
        canonicalizePath: () => Effect.succeed("/repo"),
        isGitRepository: () => Effect.succeed(true),
        listRemotes: () =>
          Effect.succeed([
            {
              name: "origin",
              url: "ssh://git@github.mycorp.com/Maxsky5/openducktor.git",
            },
          ]),
      }),
    });

    await expect(Effect.runPromise(github.repository().detectRepository("/repo"))).resolves.toEqual(
      {
        host: "github.mycorp.com",
        owner: "Maxsky5",
        name: "openducktor",
      },
    );
  });

  test("returns typed failures for missing and ambiguous repository remotes", async () => {
    const adapter = (urls: string[]) =>
      new GithubProviderAdapter({
        githubDependencies: createHealthDependencies(),
        gitPort: createGitPortTestDouble({
          canonicalizePath: () => Effect.succeed("/repo"),
          isGitRepository: () => Effect.succeed(true),
          listRemotes: () =>
            Effect.succeed(urls.map((url, index) => ({ name: `remote-${index}`, url }))),
        }),
      });

    const missing = await Effect.runPromise(
      Effect.either(adapter([]).repository().detectRepository("/repo")),
    );
    const ambiguous = await Effect.runPromise(
      Effect.either(
        adapter([
          "git@github.com:Maxsky5/openducktor.git",
          "git@github.com:someone/openducktor.git",
        ])
          .repository()
          .detectRepository("/repo"),
      ),
    );

    expect(missing._tag).toBe("Left");
    expect(ambiguous._tag).toBe("Left");
    if (missing._tag === "Left" && ambiguous._tag === "Left") {
      expect(missing.left).toBeInstanceOf(GitProviderRepositoryError);
      expect(ambiguous.left).toBeInstanceOf(GitProviderRepositoryError);
      if (
        missing.left instanceof GitProviderRepositoryError &&
        ambiguous.left instanceof GitProviderRepositoryError
      ) {
        expect(missing.left.reason).toBe("no_matching_remote");
        expect(ambiguous.left.reason).toBe("ambiguous_matching_remotes");
      }
    }
  });

  test("reports CLI version, authenticated account, and valid repository mapping", async () => {
    const github = new GithubProviderAdapter({
      githubDependencies: createHealthDependencies(),
      gitPort: createGitPortTestDouble({
        listRemotes: () =>
          Effect.succeed([{ name: "origin", url: "git@github.com:Maxsky5/openducktor.git" }]),
      }),
    });

    await expect(Effect.runPromise(github.health().getStatus(repoConfig()))).resolves.toEqual({
      providerId: "github",
      enabled: true,
      available: true,
      executablePath: "gh",
      version: "gh version 2.95.0",
      authenticated: true,
      account: "Maxsky5",
      repositoryMappingValid: true,
    });
  });

  test("checks only the active account and reports its login", async () => {
    const authCalls: string[][] = [];
    const github = new GithubProviderAdapter({
      githubDependencies: createHealthDependencies({
        runAuth: (args) => {
          authCalls.push(args);
          return args.includes("--active")
            ? {
                ok: true,
                stdout: "Logged in to github.com account active-user (keyring)",
                stderr: "",
              }
            : {
                ok: false,
                stdout: "",
                stderr: "inactive account has expired credentials",
              };
        },
      }),
      gitPort: createGitPortTestDouble({
        listRemotes: () =>
          Effect.succeed([{ name: "origin", url: "git@github.com:Maxsky5/openducktor.git" }]),
      }),
    });

    const health = await Effect.runPromise(github.health().getStatus(repoConfig()));
    await Effect.runPromise(github.repository().getRepository(repoConfig()));

    expect(health).toMatchObject({
      available: true,
      authenticated: true,
      account: "active-user",
    });
    expect(authCalls).toHaveLength(2);
    expect(authCalls).toEqual(
      authCalls.map(() => ["auth", "status", "--active", "--hostname", "github.com"]),
    );
  });

  test("rejects duplicate configured repository mappings in the repository port and health", async () => {
    const github = new GithubProviderAdapter({
      githubDependencies: createHealthDependencies(),
      gitPort: createGitPortTestDouble({
        listRemotes: () =>
          Effect.succeed([
            { name: "origin", url: "git@github.com:Maxsky5/openducktor.git" },
            { name: "backup", url: "https://github.com/Maxsky5/openducktor.git" },
          ]),
      }),
    });

    const mapping = await Effect.runPromise(
      Effect.either(github.repository().getMapping(repoConfig())),
    );
    const health = await Effect.runPromise(github.health().getStatus(repoConfig()));

    expect(mapping._tag).toBe("Left");
    if (mapping._tag === "Left") {
      expect(mapping.left).toBeInstanceOf(GitProviderRepositoryError);
      if (mapping.left instanceof GitProviderRepositoryError) {
        expect(mapping.left.reason).toBe("ambiguous_matching_remotes");
        expect(mapping.left.remoteNames).toEqual(["origin", "backup"]);
      }
    }
    expect(health).toMatchObject({
      available: false,
      authenticated: true,
      repositoryMappingValid: false,
      reason: expect.stringContaining("Multiple git remotes match"),
    });
  });

  test("reports missing CLI and failed authentication without changing capabilities", async () => {
    const gitPort = createGitPortTestDouble({
      listRemotes: () =>
        Effect.succeed([{ name: "origin", url: "git@github.com:Maxsky5/openducktor.git" }]),
    });
    const missingCli = new GithubProviderAdapter({
      githubDependencies: {
        ...createHealthDependencies(),
        resolveGithubCommand: () =>
          Effect.fail(new HostDependencyError({ dependency: "gh", message: "gh was not found" })),
      },
      gitPort,
    });
    const failedAuth = new GithubProviderAdapter({
      githubDependencies: createHealthDependencies({
        authResult: { ok: false, stdout: "", stderr: "authentication failed" },
      }),
      gitPort,
    });

    const missingCliHealth = await Effect.runPromise(missingCli.health().getStatus(repoConfig()));
    const failedAuthHealth = await Effect.runPromise(failedAuth.health().getStatus(repoConfig()));

    expect(missingCliHealth).toMatchObject({
      available: false,
      executablePath: null,
      authenticated: false,
      reason: "gh was not found",
    });
    expect(failedAuthHealth).toMatchObject({
      available: false,
      executablePath: "gh",
      authenticated: false,
      reason: "authentication failed",
    });
    expect(missingCli.getDescriptor().capabilities).toEqual(
      GITHUB_PROVIDER_DESCRIPTOR.capabilities,
    );
    expect(failedAuth.getDescriptor().capabilities).toEqual(
      GITHUB_PROVIDER_DESCRIPTOR.capabilities,
    );
  });
});
