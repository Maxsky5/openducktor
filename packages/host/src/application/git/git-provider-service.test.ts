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
  test("loads repository settings and runs provider repository and health operations", async () => {
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
        return Effect.succeed({
          providerId: "github",
          enabled: true,
          available: true,
          executablePath: "gh",
          version: "gh version test",
          authenticated: true,
          account: "octocat",
          repositoryMappingValid: true,
        });
      },
    };
    const provider: GitProviderPort = {
      getDescriptor: () => GITHUB_PROVIDER_DESCRIPTOR,
      repository: () => repository,
      health: () => health,
      pullRequests: () =>
        Effect.succeed({
          findByBranch: () => Effect.die("Unexpected findByBranch call"),
          getByNumber: () => Effect.die("Unexpected getByNumber call"),
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
    const healthRepoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: { provider: { id: "github", enabled: true } },
    });
    const repoConfigs = [detectionRepoConfig, healthRepoConfig];
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
    await expect(Effect.runPromise(service.getHealth("/repo"))).resolves.toMatchObject({
      providerId: "github",
      available: true,
    });
    expect(calls).toEqual(["settings:/repo", "/repo", "settings:/repo", "health:/repo"]);
  });
});
