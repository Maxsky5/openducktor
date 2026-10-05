import type { HostRuntimeStatus } from "@openducktor/contracts";

export type RuntimeStatusLog = { level: "info" | "error"; message: string };

/**
 * Describes a runtime state change for the host log, so the log shows each start, stop, and
 * failure even when no frontend is connected. Returns null when the state did not change.
 */
export const describeRuntimeStatusChange = (
  previous: HostRuntimeStatus["state"] | undefined,
  status: HostRuntimeStatus,
  label: string,
): RuntimeStatusLog | null => {
  if (status.state === previous) return null;
  const name = status.runtimeId ? `${label} runtime ${status.runtimeId}` : `${label} runtime`;
  switch (status.state) {
    case "starting":
      return {
        level: "info",
        message: `Starting the ${label} runtime with ${status.configuredExecutablePath}.`,
      };
    case "restarting":
      return { level: "info", message: `Restarting the ${name}.` };
    case "ready":
      return {
        level: "info",
        message: `The ${name} is ready: ${status.effectiveExecutablePath}, version ${status.version ?? "unknown"}.`,
      };
    case "stopping":
      return { level: "info", message: `Stopping the ${name}.` };
    case "disabled":
      if (previous !== undefined) {
        return { level: "info", message: `The ${label} runtime stopped.` };
      }
      // The first status of an enabled kind is "disabled" only until its start begins.
      return status.enabled
        ? null
        : { level: "info", message: `The ${label} runtime is disabled in settings.` };
    case "error":
      return status.failure
        ? {
            level: "error",
            message: `The ${name} failed during ${status.failure.phase}: ${status.failure.message} ${status.failure.nextAction}`,
          }
        : null;
  }
};
