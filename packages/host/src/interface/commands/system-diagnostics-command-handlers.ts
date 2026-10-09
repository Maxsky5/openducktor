import type { SystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputOptionalBooleanSchema,
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  optionalBoolean,
  requireRecord,
  requireString,
} from "./command-inputs";

export const createSystemDiagnosticsCommandHandlers = (service: SystemDiagnosticsService) =>
  ({
    path_check: (args) => service.pathCheck(parseForce(args)),
    task_store_check: (args) => service.taskStoreCheck(parseRepoPath(args)),
    git_check: () => service.gitCheck(),
  }) satisfies HostCommandHandlerDefinitions;

const parseForce = (args: HostCommandArgs): boolean | undefined => {
  const record =
    args === undefined
      ? undefined
      : requireRecord(commandInputRecordSchema.safeParse(args), "path_check input");
  return optionalBoolean(
    commandInputOptionalBooleanSchema.safeParse(record?.force),
    "path_check force",
  );
};

const parseRepoPath = (args: HostCommandArgs): string => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), "task_store_check input");
  return requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
};
