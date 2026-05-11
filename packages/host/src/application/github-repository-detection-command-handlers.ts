import type { GithubRepositoryDetectionService } from "./github-repository-detection-service";
import type { HostCommandHandlers } from "./host-command-router";

export const createGithubRepositoryDetectionCommandHandlers = (
  service: GithubRepositoryDetectionService,
): HostCommandHandlers => ({
  workspace_detect_github_repository: (args) => service.detectGithubRepository(args),
});
