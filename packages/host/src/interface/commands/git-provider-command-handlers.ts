import { GITHUB_PROVIDER_DESCRIPTOR } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderService } from "../../application/git/git-provider-service";
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

export const createGitProviderCommandHandlers = ({ service }: { service: GitProviderService }) =>
  ({
    workspace_detect_github_repository: (args) =>
      Effect.gen(function* () {
        const repoPath = parseRepoPath(args, "workspace_detect_github_repository");
        return yield* service.detectRepository({
          repoPath,
          providerId: GITHUB_PROVIDER_DESCRIPTOR.id,
        });
      }),
    workspace_get_git_provider_context: (args) =>
      Effect.gen(function* () {
        const repoPath = parseRepoPath(args, "workspace_get_git_provider_context");
        return yield* service.getContext(repoPath);
      }),
  }) satisfies HostCommandHandlerDefinitions;
