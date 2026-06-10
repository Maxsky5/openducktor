import type { SystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { optionalBoolean, requireRecord, requireString } from "./command-inputs";

const parseRuntimeCheckForce = (args: Record<string, unknown> | undefined): boolean | undefined =>
  optionalBoolean(args?.force, "runtime_check force");

const parseRepoPath = (args: Record<string, unknown> | undefined, command: string): string => {
  const record = requireRecord(args, `${command} input`);
  return requireString(record.repoPath, "repoPath");
};

export const createSystemDiagnosticsCommandHandlers = (
  systemDiagnosticsService: SystemDiagnosticsService,
): HostCommandHandlers => ({
  runtime_check: (args) => systemDiagnosticsService.runtimeCheck(parseRuntimeCheckForce(args)),
  task_store_check: (args) =>
    systemDiagnosticsService.taskStoreCheck(parseRepoPath(args, "task_store_check")),
  system_check: (args) => systemDiagnosticsService.systemCheck(parseRepoPath(args, "system_check")),
});
