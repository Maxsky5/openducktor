import { describe, expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
} from "../../ports/git-provider-port";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { createGitProviderResolver } from "./git-provider-resolver";
import { createGitProviderService } from "./git-provider-service";

describe("GitProviderService", () => {
  test("loads repository settings and returns the resolved provider context", async () => {
    const calls: string[] = [];
    const repository: GitProviderRepositoryPort = {
      detectRepository(repoPath) {
        calls.push(repoPath);
        return Effect.succeed({
          host: "github.mycorp.com",
          owner: "openai",
          name: "openducktor",
        });
      },
      getRepository: () => Effect.die("Unexpected getRepository call"),
      getMapping: () => Effect.die("Unexpected getMapping call"),
    };
    const health: GitProviderHealthPort = {
      getStatus: (config) => {
        calls.push(`health:${config.repoPath}`);
        const enabled = config.git.provider?.enabled === true;
        return Effect.succeed({
          providerId: "github",
          enabled,
          available: enabled,
          executablePath: enabled ? "gh" : null,
          version: enabled ? "gh version test" : null,
          authenticated: enabled,
          account: enabled ? "octocat" : null,
          repositoryMappingValid: enabled ? true : null,
          reason: enabled ? undefined : "GitHub provider is not enabled for this repository.",
        });
      },
    };
    const provider: GitProviderPort = {
      getDescriptor: () => GITHUB_PROVIDER_DESCRIPTOR,
      repository: () => repository,
      health: () => health,
      pullRequests: () =>
        Effect.succeed({
          providerId: "github",
          findOpenForSourceBranch: () => Effect.die("Unexpected findOpenForSourceBranch call"),
          findLatestMergedForSourceBranch: () =>
            Effect.die("Unexpected findLatestMergedForSourceBranch call"),
          getByNumber: () => Effect.die("Unexpected getByNumber call"),
          refresh: () => Effect.die("Unexpected refresh call"),
          resolvePublishRemote: () => Effect.die("Unexpected resolvePublishRemote call"),
          upsert: () => Effect.die("Unexpected upsert call"),
        }),
      pullRequestReview: () =>
        Effect.succeed({
          providerId: "github",
          readContext: () => Effect.die("Unexpected readContext call"),
        }),
    };
    const resolver = await Effect.runPromise(createGitProviderResolver([provider]));
    const detectionRepoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: {},
    });
    const contextRepoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: { provider: { id: "github", enabled: false } },
    });
    const repoConfigs = [detectionRepoConfig, contextRepoConfig];
    const service = createGitProviderService({
      resolver,
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfigByRepoPath: (repoPath) => {
          calls.push(`settings:${repoPath}`);
          const repoConfig = repoConfigs.shift();
          return repoConfig
            ? Effect.succeed(repoConfig)
            : Effect.die("Unexpected repository settings read");
        },
      }),
    });

    await expect(
      Effect.runPromise(service.detectRepository({ repoPath: "/repo", providerId: "github" })),
    ).resolves.toEqual({
      host: "github.mycorp.com",
      owner: "openai",
      name: "openducktor",
    });
    await expect(Effect.runPromise(service.getContext("/repo"))).resolves.toEqual({
      descriptor: GITHUB_PROVIDER_DESCRIPTOR,
      config: contextRepoConfig.git.provider!,
      health: {
        providerId: "github",
        enabled: false,
        available: false,
        executablePath: null,
        version: null,
        authenticated: false,
        account: null,
        repositoryMappingValid: null,
        reason: "GitHub provider is not enabled for this repository.",
      },
    });
    expect(calls).toEqual(["settings:/repo", "/repo", "settings:/repo", "health:/repo"]);
  });

  test("returns null when no provider is configured", async () => {
    const repoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: {},
    });
    const resolver = await Effect.runPromise(createGitProviderResolver([]));
    const service = createGitProviderService({
      resolver,
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfigByRepoPath: () => Effect.succeed(repoConfig),
      }),
    });

    await expect(Effect.runPromise(service.getContext("/repo"))).resolves.toBeNull();
  });
});
