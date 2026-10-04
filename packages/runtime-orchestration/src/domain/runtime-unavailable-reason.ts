import type { HostRuntimeFailure, HostRuntimeLifecycleState } from "@openducktor/contracts";

export type RuntimeUnavailableReason = {
  readonly message: string;
  readonly nextAction: string;
};

/** Explains why a shared runtime cannot accept work, and what the user does next. */
export const describeUnavailableRuntime = (
  label: string,
  state: HostRuntimeLifecycleState,
  failure: HostRuntimeFailure | null,
): RuntimeUnavailableReason => {
  switch (state) {
    case "disabled":
      return {
        message: `The ${label} runtime is disabled.`,
        nextAction: "Enable it in Settings > Runtimes.",
      };
    case "error":
      return {
        message: failure?.message ?? `The ${label} runtime failed.`,
        nextAction: failure?.nextAction ?? "Restart the runtime from Diagnostics.",
      };
    case "ready":
      return {
        message: `The ${label} runtime is applying a lifecycle action.`,
        nextAction: "Wait for the action to finish.",
      };
    default:
      return {
        message: `The ${label} runtime is ${state}.`,
        nextAction: "Wait for the runtime to become ready.",
      };
  }
};
