import { describe, expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createGitProviderResolver } from "../../../application/git/git-provider-resolver";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { GitProviderRepositoryError } from "../../../ports/git-provider-errors";
import type { SystemCommandPort, SystemCommandRunResult } from "../../../ports/system-command-port";
import { createGitPortTestDouble } from "../../../test-support/service-test-doubles";
import { GithubProviderAdapter } from "./provider-adapter";

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
  authResult = { ok: true, stdout: "Maxsky5\n", stderr: "" },
  runAuth,
  version = "gh version 2.95.0",
}: {
  authResult?: SystemCommandRunResult;
  runAuth?: (args: string[]) => SystemCommandRunResult;
  version?: string | null;
} = {}) => {
  const systemCommands: SystemCommandPort = {
    resolveCommandPath: () => Effect.die("Unexpected resolveCommandPath call"),
    versionCommand: () => Effect.succeed(version),
    runCommandAllowFailure: (_command, args) => Effect.succeed(runAuth?.(args) ?? authResult),
  };
  return {
    systemCommands,
    toolDiscovery: {
      discoverTool: () => Effect.die("Unexpected discoverTool call"),
      resolveTool: () => Effect.die("Unexpected resolveTool call"),
      resolveToolPath: () => Effect.succeed("gh"),
      validateToolPath: () => Effect.die("Unexpected validateToolPath call"),
    },
  };
};

const createDetectionAdapter = (urls: string[]) =>
  new GithubProviderAdapter({
    ...createHealthDependencies(),
    gitPort: createGitPortTestDouble({
      canonicalizePath: () => Effect.succeed("/repo"),
      isGitRepository: () => Effect.succeed(true),
      listRemotes: () =>
        Effect.succeed(urls.map((url, index) => ({ name: `remote-${index}`, url }))),
    }),
  });

describe("GithubProviderAdapter", () => {
  test("resolves as the configured provider with typed capability access", async () => {
    const github = new GithubProviderAdapter({
      gitPort: createGitPortTestDouble({}),
      ...createHealthDependencies(),
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
        Effect.succeed([{ name: "origin", url: "https://github.com/Maxsky5/openducktor.git" }]),
    });
    const dependencies = createHealthDependencies({
      runAuth: (args) => {
        if (args[0] === "api" && args[1] === "user") {
          return { ok: true, stdout: "Maxsky5\n", stderr: "" };
        }
        if (args.some((arg) => arg.endsWith("/pulls/42"))) {
          return {
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
          };
        }
        return { ok: true, stdout: "[]", stderr: "" };
      },
    });
    const github = new GithubProviderAdapter({ ...dependencies, gitPort });
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
    expect(byNumber.record.number).toBe(42);
  });

  test("detects one GitHub repository identity across supported remote URL forms", async () => {
    const github = createDetectionAdapter([
      "https://token@github.com/Maxsky5/openducktor.git",
      "git@github.com:Maxsky5/openducktor.git",
      "ssh://git@github.com/Maxsky5/openducktor.git",
    ]);

    await expect(Effect.runPromise(github.repository().detectRepository("/repo"))).resolves.toEqual(
      { host: "github.com", owner: "Maxsky5", name: "openducktor" },
    );
  });

  test("detects GitHub Enterprise repositories", async () => {
    const github = createDetectionAdapter(["ssh://git@github.mycorp.com/Maxsky5/openducktor.git"]);

    await expect(Effect.runPromise(github.repository().detectRepository("/repo"))).resolves.toEqual(
      {
        host: "github.mycorp.com",
        owner: "Maxsky5",
        name: "openducktor",
      },
    );
  });

  test("accepts the default HTTPS port for GitHub Enterprise", async () => {
    const github = createDetectionAdapter([
      "https://github.mycorp.com:443/Maxsky5/openducktor.git",
    ]);

    await expect(Effect.runPromise(github.repository().detectRepository("/repo"))).resolves.toEqual(
      {
        host: "github.mycorp.com",
        owner: "Maxsky5",
        name: "openducktor",
      },
    );
  });

  test("rejects GitHub remotes with a non-default HTTPS port", async () => {
    const github = createDetectionAdapter([
      "https://github.mycorp.com:8443/Maxsky5/openducktor.git",
    ]);

    const result = await Effect.runPromise(
      Effect.either(github.repository().detectRepository("/repo")),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(GitProviderRepositoryError);
      if (result.left instanceof GitProviderRepositoryError) {
        expect(result.left.reason).toBe("no_matching_remote");
      }
    }
  });

  test("returns typed failures for missing and ambiguous repository remotes", async () => {
    const missing = await Effect.runPromise(
      Effect.either(createDetectionAdapter([]).repository().detectRepository("/repo")),
    );
    const ambiguous = await Effect.runPromise(
      Effect.either(
        createDetectionAdapter([
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
      ...createHealthDependencies(),
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

  test("checks authentication through health only", async () => {
    const authCalls: string[][] = [];
    const github = new GithubProviderAdapter({
      ...createHealthDependencies({
        runAuth: (args) => {
          authCalls.push(args);
          return { ok: true, stdout: "active-user\n", stderr: "" };
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
    expect(authCalls).toHaveLength(1);
    expect(authCalls).toEqual(
      authCalls.map(() => ["api", "user", "--hostname", "github.com", "--jq", ".login"]),
    );
  });

  test("rejects a configured port-qualified host before checking authentication", async () => {
    const authCalls: string[][] = [];
    const github = new GithubProviderAdapter({
      ...createHealthDependencies({
        runAuth: (args) => {
          authCalls.push(args);
          return { ok: true, stdout: "active-user\n", stderr: "" };
        },
      }),
      gitPort: createGitPortTestDouble({}),
    });
    const config = repoConfig("github.mycorp.com:8443");

    const repository = await Effect.runPromise(
      Effect.either(github.repository().getRepository(config)),
    );
    const health = await Effect.runPromise(github.health().getStatus(config));

    expect(repository._tag).toBe("Left");
    if (repository._tag === "Left") {
      expect(repository.left).toBeInstanceOf(HostValidationError);
      if (repository.left instanceof HostValidationError) {
        expect(repository.left.field).toBe("git.provider.repository.host");
      }
    }
    expect(health).toMatchObject({
      available: false,
      authenticated: false,
      repositoryMappingValid: false,
      reason: "GitHub CLI does not support repository hosts with ports: github.mycorp.com:8443.",
    });
    expect(authCalls).toEqual([]);
  });

  test("rejects duplicate configured repository mappings in the repository port and health", async () => {
    const github = new GithubProviderAdapter({
      ...createHealthDependencies(),
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
      gitPort,
      systemCommands: createHealthDependencies().systemCommands,
      toolDiscovery: {
        ...createHealthDependencies().toolDiscovery,
        resolveToolPath: () =>
          Effect.fail(new HostDependencyError({ dependency: "gh", message: "gh was not found" })),
      },
    });
    const failedAuth = new GithubProviderAdapter({
      ...createHealthDependencies({
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
