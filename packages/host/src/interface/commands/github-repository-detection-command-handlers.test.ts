import { Effect } from "effect";
import { repoConfigSchema } from "@openducktor/contracts";
import type { GitProviderRepositoryService } from "../../application/git/git-provider-repository-service";
import { HostOperationError } from "../../effect/host-errors";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createGithubRepositoryDetectionCommandHandlers } from "./github-repository-detection-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

describe("createGithubRepositoryDetectionCommandHandlers", () => {
  test("routes workspace_detect_github_repository to the detection service", async () => {
    const calls: unknown[] = [];
    const service: GitProviderRepositoryService = {
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
    };
    const repoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: {},
    });
    const router = createHostCommandRouter({
      handlers: createGithubRepositoryDetectionCommandHandlers({
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
  });
});
