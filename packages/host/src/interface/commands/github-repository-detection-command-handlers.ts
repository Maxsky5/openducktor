import type {
  GithubRepositoryDetectionInput,
  GithubRepositoryDetectionService,
} from "../../application/git/github-repository-detection-service";
import { defineHostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";

const parseDetectionInput = (
  args: Record<string, unknown> | undefined,
): GithubRepositoryDetectionInput => {
  const record = requireRecord(args, "workspace_detect_github_repository input");
  return { repoPath: requireString(record.repoPath, "repoPath") };
};

export const createGithubRepositoryDetectionCommandHandlers = (
  service: GithubRepositoryDetectionService,
) =>
  defineHostCommandHandlers({
    workspace_detect_github_repository: (args) =>
      service.detectGithubRepository(parseDetectionInput(args)),
  });
