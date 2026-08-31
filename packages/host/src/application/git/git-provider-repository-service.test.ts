import { describe, expect, test } from "bun:test";
import { GITHUB_PROVIDER_DESCRIPTOR, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
} from "../../ports/git-provider-port";
import { createGitProviderResolver } from "./git-provider-resolver";
import { createGitProviderRepositoryService } from "./git-provider-repository-service";

describe("GitProviderRepositoryService", () => {
  test("resolves the configured provider and detects through its repository port", async () => {
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
      getStatus: () => Effect.die("Unexpected health call"),
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
    const service = createGitProviderRepositoryService(resolver);
    const repoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: { provider: { id: "github", enabled: true } },
    });

    await expect(Effect.runPromise(service.detectRepository({ repoConfig }))).resolves.toEqual({
      host: "github.mycorp.com",
      owner: "openai",
      name: "openducktor",
    });
    expect(calls).toEqual(["/repo"]);
  });
});
