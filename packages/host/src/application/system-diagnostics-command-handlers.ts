import type { HostCommandHandlers } from "./host-command-router";
import type { SystemDiagnosticsService } from "./system-diagnostics-service";

const requireObjectArg = (
  command: string,
  args: Record<string, unknown> | undefined,
  field: string,
): unknown => {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`${command} requires an object argument with ${field}.`);
  }
  if (!(field in args)) {
    throw new Error(`${command} requires an object argument with ${field}.`);
  }
  return args[field];
};

export const createSystemDiagnosticsCommandHandlers = (
  systemDiagnosticsService: SystemDiagnosticsService,
): HostCommandHandlers => ({
  runtime_check: (args) => systemDiagnosticsService.runtimeCheck(args?.force),
  beads_check: (args) =>
    systemDiagnosticsService.beadsCheck(requireObjectArg("beads_check", args, "repoPath")),
  system_check: (args) =>
    systemDiagnosticsService.systemCheck(requireObjectArg("system_check", args, "repoPath")),
});
