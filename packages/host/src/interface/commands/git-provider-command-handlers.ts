import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  GITHUB_PROVIDER_DESCRIPTOR,
  GITLAB_PROVIDER_DESCRIPTOR,
  type WorkspaceRef,
} from "@openducktor/contracts";
import type { GitProviderService } from "../../application/git/git-provider-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

const parseWorkspace = (args: HostCommandArgs, command: string): WorkspaceRef => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), `${command} input`);
  return {
    workspaceId: requireString(
      commandInputStringSchema.safeParse(record.workspaceId),
      "workspaceId",
    ),
    repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
  };
};

export const createGitProviderCommandHandlers = ({ service }: { service: GitProviderService }) =>
  ({
    workspace_detect_azure_devops_repository: (args) =>
      service.detectRepository({
        ...parseWorkspace(args, "workspace_detect_azure_devops_repository"),
        providerId: AZURE_DEVOPS_PROVIDER_DESCRIPTOR.id,
      }),
    workspace_detect_github_repository: (args) =>
      service.detectRepository({
        ...parseWorkspace(args, "workspace_detect_github_repository"),
        providerId: GITHUB_PROVIDER_DESCRIPTOR.id,
      }),
    workspace_detect_gitlab_repository: (args) =>
      service.detectRepository({
        ...parseWorkspace(args, "workspace_detect_gitlab_repository"),
        providerId: GITLAB_PROVIDER_DESCRIPTOR.id,
      }),
    workspace_get_git_provider_context: (args) =>
      service.getContext(parseWorkspace(args, "workspace_get_git_provider_context")),
  }) satisfies HostCommandHandlerDefinitions;
