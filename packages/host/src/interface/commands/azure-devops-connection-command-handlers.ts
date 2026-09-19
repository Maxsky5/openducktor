import { azureDevOpsRepositorySchema, type AzureDevOpsRepository } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import type { AzureDevOpsConnectionService } from "../../application/git/azure-devops-connection-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputOptionalStringSchema,
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  optionalString,
  requireRecord,
  requireString,
} from "./command-inputs";

type ParsedConnectionInput = {
  repoPath: string;
  repository: AzureDevOpsRepository;
  httpConsentCollectionUrl?: string;
};

const parseConnectionInput = (args: HostCommandArgs, command: string) => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), `${command} input`);
  const repository = azureDevOpsRepositorySchema.safeParse(record.repository);
  if (!repository.success) {
    throw new HostValidationError({
      field: "repository",
      message: repository.error.issues[0]?.message ?? "Enter a valid Azure DevOps repository.",
    });
  }
  const input: ParsedConnectionInput = {
    repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
    repository: repository.data,
  };
  const consent = optionalString(
    commandInputOptionalStringSchema.safeParse(record.httpConsentCollectionUrl),
    "httpConsentCollectionUrl",
  );
  if (consent) input.httpConsentCollectionUrl = consent;
  return { input, record };
};

export const createAzureDevOpsConnectionCommandHandlers = ({
  service,
}: {
  service: AzureDevOpsConnectionService;
}) =>
  ({
    workspace_get_azure_devops_connection: (args) => {
      const { input } = parseConnectionInput(args, "workspace_get_azure_devops_connection");
      return service.getConnection(input);
    },
    workspace_start_azure_devops_sign_in: (args) => {
      const { input } = parseConnectionInput(args, "workspace_start_azure_devops_sign_in");
      return service.startSignIn(input);
    },
    workspace_cancel_azure_devops_sign_in: (args) => {
      const record = requireRecord(
        commandInputRecordSchema.safeParse(args),
        "workspace_cancel_azure_devops_sign_in input",
      );
      return service.cancelSignIn(
        requireString(commandInputStringSchema.safeParse(record.attemptId), "attemptId"),
      );
    },
    workspace_replace_azure_devops_pat: (args) => {
      const { input, record } = parseConnectionInput(args, "workspace_replace_azure_devops_pat");
      return service.replacePat({
        ...input,
        pat: requireString(commandInputStringSchema.safeParse(record.pat), "pat"),
      });
    },
    workspace_disconnect_azure_devops: (args) => {
      const { input } = parseConnectionInput(args, "workspace_disconnect_azure_devops");
      return service.disconnect(input);
    },
  }) satisfies HostCommandHandlerDefinitions;
