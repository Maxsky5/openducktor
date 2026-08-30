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

const parseRuntimeCheckForce = (args: HostCommandArgs): boolean | undefined => {
  const record =
    args === undefined
      ? undefined
      : requireRecord(commandInputRecordSchema.safeParse(args), "runtime_check input");
  return optionalBoolean(
    commandInputOptionalBooleanSchema.safeParse(record?.force),
    "runtime_check force",
  );
};

const parseRepoPath = (args: HostCommandArgs, command: string): string => {
  const record = requireRecord(commandInputRecordSchema.safeParse(args), `${command} input`);
  return requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
};

export const createSystemDiagnosticsCommandHandlers = (
  systemDiagnosticsService: SystemDiagnosticsService,
) =>
  ({
    runtime_check: (args) => systemDiagnosticsService.runtimeCheck(parseRuntimeCheckForce(args)),
    task_store_check: (args) =>
      systemDiagnosticsService.taskStoreCheck(parseRepoPath(args, "task_store_check")),
    system_check: (args) =>
      systemDiagnosticsService.systemCheck(parseRepoPath(args, "system_check")),
  }) satisfies HostCommandHandlerDefinitions;
