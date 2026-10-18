import type { HostRuntimeFailure, HostRuntimeLifecycleState } from "@openducktor/contracts";

/** A lifecycle action is in progress. The kind accepts no other lifecycle action. */
export const isHostRuntimeLifecycleBusy = (state: HostRuntimeLifecycleState): boolean =>
  state === "starting" || state === "restarting" || state === "stopping";

/** Tells the user why the kind cannot accept session actions and what to do. */
export const describeHostRuntimeUnavailable = (
  runtimeLabel: string,
  state: Exclude<HostRuntimeLifecycleState, "ready">,
  failure: HostRuntimeFailure | null,
): string => {
  switch (state) {
    case "starting":
      return `${runtimeLabel} runtime is starting. Wait until it is ready.`;
    case "restarting":
      return `${runtimeLabel} runtime is restarting. Wait until it is ready.`;
    case "stopping":
      return `${runtimeLabel} runtime is stopping.`;
    case "disabled":
      return `${runtimeLabel} runtime is disabled. Enable it in Settings > Runtimes.`;
    case "error":
      return failure === null
        ? `${runtimeLabel} runtime is unavailable. Restart it from Diagnostics.`
        : `${failure.message} ${failure.nextAction}`;
  }
};
