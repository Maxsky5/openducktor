import { Effect } from "effect";
import { repoConfigSchema } from "@openducktor/contracts";
import type { GitProviderService } from "../../application/git/git-provider-service";
import { HostOperationError } from "../../effect/host-errors";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createGitProviderCommandHandlers } from "./git-provider-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

describe("createGitProviderCommandHandlers", () => {
  test("routes workspace_detect_github_repository to the detection service", async () => {
    const calls: unknown[] = [];
    const service: GitProviderService = {
      detectRepository(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            return { host: "github.com", owner: "openai", name: "openducktor" };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getHealth(config) {
        calls.push(config);
        return Effect.succeed({
          providerId: "github",
          enabled: true,
          available: true,
          executablePath: "gh",
          version: "gh version 2.95.0",
          authenticated: true,
          account: "octocat",
          repositoryMappingValid: true,
        });
      },
    };
    const repoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: {},
    });
    const router = createHostCommandRouter({
      handlers: createGitProviderCommandHandlers({
        service,
        workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
          getRepoConfigByRepoPath: () => Effect.succeed(repoConfig),
        }),
      }),
    });
    await expect(
      router.invoke("workspace_detect_github_repository", { repoPath: "/repo" }),
    ).resolves.toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
    expect(calls).toEqual([
      {
        repoConfig: expect.objectContaining({
          repoPath: "/repo",
          git: {
            provider: {
              id: "github",
              enabled: true,
              autoDetected: false,
            },
          },
        }),
      },
    ]);

    await expect(
      router.invoke("workspace_get_git_provider_health", { repoPath: "/repo" }),
    ).resolves.toMatchObject({ providerId: "github", available: true });
    expect(calls.at(-1)).toBe(repoConfig);
  });
});
