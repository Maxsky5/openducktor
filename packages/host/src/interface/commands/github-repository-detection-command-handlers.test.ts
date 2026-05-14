import type { GithubRepositoryDetectionService } from "../../application/git/github-repository-detection-service";
import { createHostCommandRouter } from "../router/host-command-router";
import { createGithubRepositoryDetectionCommandHandlers } from "./github-repository-detection-command-handlers";

describe("createGithubRepositoryDetectionCommandHandlers", () => {
  test("routes workspace_detect_github_repository to the detection service", async () => {
    const calls: unknown[] = [];
    const service: GithubRepositoryDetectionService = {
      async detectGithubRepository(input) {
        calls.push(input);
        return { host: "github.com", owner: "openai", name: "openducktor" };
      },
    };
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
