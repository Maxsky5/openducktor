import type {
  GithubRepositoryDetectionInput,
  GithubRepositoryDetectionService,
} from "../../application/git/github-repository-detection-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

const parseDetectionInput = (args: HostCommandArgs): GithubRepositoryDetectionInput => {
  const record = requireRecord(
    commandInputRecordSchema.safeParse(args),
    "workspace_detect_github_repository input",
  );
  return {
    repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
  };
};

export const createGithubRepositoryDetectionCommandHandlers = (
  service: GithubRepositoryDetectionService,
) =>
  ({
    workspace_detect_github_repository: (args) =>
      service.detectGithubRepository(parseDetectionInput(args)),
  }) satisfies HostCommandHandlerDefinitions;
