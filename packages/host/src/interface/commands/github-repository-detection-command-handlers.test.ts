import { Effect } from "effect";
import type { GithubRepositoryDetectionService } from "../../application/git/github-repository-detection-service";
import { HostOperationError } from "../../effect/host-errors";
import { createHostCommandRouter } from "../router/host-command-router";
import { createGithubRepositoryDetectionCommandHandlers } from "./github-repository-detection-command-handlers";

const createGithubRepositoryDetectionServiceFake = (
  service: GithubRepositoryDetectionService,
): GithubRepositoryDetectionService => service as GithubRepositoryDetectionService;
describe("createGithubRepositoryDetectionCommandHandlers", () => {
  test("routes workspace_detect_github_repository to the detection service", async () => {
    const calls: unknown[] = [];
    const service = createGithubRepositoryDetectionServiceFake({
      detectGithubRepository(input) {
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
    });
    const router = createHostCommandRouter({
      handlers: createGithubRepositoryDetectionCommandHandlers(service),
    });
    await expect(
      router.invoke("workspace_detect_github_repository", { repoPath: "/repo" }),
    ).resolves.toEqual({
      host: "github.com",
      owner: "openai",
      name: "openducktor",
    });
    expect(calls).toEqual([{ repoPath: "/repo" }]);
  });
});
