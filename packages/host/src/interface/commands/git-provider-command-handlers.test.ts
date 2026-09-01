import { Effect } from "effect";
import type { GitProviderService } from "../../application/git/git-provider-service";
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
        calls.push(input);
        return Effect.succeed({ host: "github.com", owner: "openai", name: "openducktor" });
      },
      getHealth(repoPath) {
        calls.push(repoPath);
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
    const router = createHostCommandRouter({
      handlers: createGitProviderCommandHandlers({
        service,
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
        repoPath: "/repo",
        providerId: "github",
      },
    ]);

    await expect(
      router.invoke("workspace_get_git_provider_health", { repoPath: "/repo" }),
    ).resolves.toMatchObject({ providerId: "github", available: true });
    expect(calls.at(-1)).toBe("/repo");
  });
});
