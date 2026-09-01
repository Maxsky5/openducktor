import { GITHUB_PROVIDER_DESCRIPTOR } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderService } from "../../application/git/git-provider-service";
import { errorMessage, HostValidationError, isHostError } from "../../effect/host-errors";
import { GitProviderRepositoryError } from "../../ports/git-provider-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

const parseRepoPath = (args: HostCommandArgs, command: string): string => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), `${command} input`);
  return requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
};

const providerError = (cause: unknown) => {
  if (isHostError(cause)) {
    return cause;
  }
  if (cause instanceof GitProviderRepositoryError) {
    return new HostValidationError({
      field: "git.provider.repository",
      message: cause.message,
      cause,
      details: {
        reason: cause.reason,
        repoPath: cause.repoPath,
        remoteNames: cause.remoteNames,
        repositories: cause.repositories,
      },
    });
  }
  return new HostValidationError({ message: errorMessage(cause), cause });
};

export const createGitProviderCommandHandlers = ({ service }: { service: GitProviderService }) =>
  ({
    workspace_detect_github_repository: (args) =>
      Effect.gen(function* () {
        const repoPath = parseRepoPath(args, "workspace_detect_github_repository");
        return yield* service.detectRepository({
          repoPath,
          providerId: GITHUB_PROVIDER_DESCRIPTOR.id,
        });
      }).pipe(Effect.mapError(providerError)),
    workspace_get_git_provider_health: (args) =>
      Effect.gen(function* () {
        const repoPath = parseRepoPath(args, "workspace_get_git_provider_health");
        return yield* service.getHealth(repoPath);
      }).pipe(Effect.mapError(providerError)),
  }) satisfies HostCommandHandlerDefinitions;
