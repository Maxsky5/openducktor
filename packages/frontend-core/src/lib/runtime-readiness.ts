import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { HOST_CONNECTION_WAITING_MESSAGE, reportsFailure } from "./host-failure";
import { describeHostRuntimeUnavailable } from "./host-runtime-status";
import type { HostRuntimeStatusContextValue } from "../types/session-slices";

export type RuntimeReadinessState = "ready" | "checking" | "blocked";

export type RuntimeReadinessSnapshot = {
  state: RuntimeReadinessState;
  message: string | null;
};

export type RuntimeReadinessTarget =
  | { kind: "all" }
  | { kind: "runtime"; runtimeKind: RuntimeKind }
  | { kind: "resolving" }
  | { kind: "inactive" };

export const allRuntimeReadinessTarget = {
  kind: "all",
} satisfies RuntimeReadinessTarget;

export const resolvingRuntimeReadinessTarget = {
  kind: "resolving",
} satisfies RuntimeReadinessTarget;

export const inactiveRuntimeReadinessTarget = {
  kind: "inactive",
} satisfies RuntimeReadinessTarget;

export const runtimeReadinessTargetForRuntime = (
  runtimeKind: RuntimeKind | null | undefined,
): RuntimeReadinessTarget => {
  if (!runtimeKind) {
    return allRuntimeReadinessTarget;
  }

  return { kind: "runtime", runtimeKind };
};

export type RuntimeStatusReadinessInput = Pick<
  HostRuntimeStatusContextValue,
  "statusByKind" | "isCurrent" | "readError" | "streamError"
>;

type DeriveRuntimeReadinessArgs = {
  hasWorkspace: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeStatus: RuntimeStatusReadinessInput;
  runtimeTarget?: RuntimeReadinessTarget;
};

/** For the `all` target, one ready kind is enough. */
export const deriveRuntimeReadiness = ({
  hasWorkspace,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeStatus,
  runtimeTarget = allRuntimeReadinessTarget,
}: DeriveRuntimeReadinessArgs): RuntimeReadinessSnapshot => {
  if (!hasWorkspace) {
    return { state: "blocked", message: "Select a repository to use agent sessions." };
  }
  if (runtimeTarget.kind === "inactive") {
    return { state: "ready", message: null };
  }
  if (runtimeDefinitionsError) {
    return { state: "blocked", message: runtimeDefinitionsError };
  }
  if (isLoadingRuntimeDefinitions) {
    return { state: "checking", message: "Loading runtime definitions..." };
  }
  if (runtimeTarget.kind === "resolving") {
    return { state: "checking", message: "Resolving selected agent runtime..." };
  }

  let definitions = runtimeDefinitions;
  if (runtimeTarget.kind === "runtime") {
    const definition = runtimeDefinitions.find(({ kind }) => kind === runtimeTarget.runtimeKind);
    if (!definition) {
      return {
        state: "blocked",
        message: `Runtime '${runtimeTarget.runtimeKind}' is not available for agent sessions.`,
      };
    }
    definitions = [definition];
  }

  const entries = definitions.map((definition) =>
    readRuntimeKindReadiness(runtimeStatus, definition),
  );
  // A kind that is still checking can become ready, so it wins over a blocked kind.
  return (
    entries.find((entry) => entry.state === "ready") ??
    entries.find((entry) => entry.state === "checking") ??
    entries.find((entry) => entry.state === "blocked") ?? {
      state: "blocked",
      message: "No agent runtimes are available.",
    }
  );
};

/**
 * Readiness of one exact kind. Only a current `ready` host status allows session actions and runtime
 * reads. The label names the runtime in the message.
 */
export const readRuntimeKindReadiness = (
  runtimeStatus: RuntimeStatusReadinessInput,
  runtime: Pick<RuntimeDescriptor, "kind" | "label">,
): RuntimeReadinessSnapshot => {
  if (reportsFailure(runtimeStatus.streamError)) {
    return {
      state: "blocked",
      message: `Runtime status is not current because live updates stopped: ${runtimeStatus.streamError.message} Select Recheck to read it again.`,
    };
  }
  if (reportsFailure(runtimeStatus.readError)) {
    return {
      state: "blocked",
      message: `Runtime status could not be read: ${runtimeStatus.readError.message} Select Recheck to read it again.`,
    };
  }
  // Only a lost host connection is left. The status reads again after reconnect.
  if (runtimeStatus.streamError !== null || runtimeStatus.readError !== null) {
    return { state: "checking", message: HOST_CONNECTION_WAITING_MESSAGE };
  }
  const status = runtimeStatus.statusByKind[runtime.kind];
  if (status === undefined || !runtimeStatus.isCurrent) {
    return { state: "checking", message: "Loading runtime status..." };
  }
  switch (status.state) {
    case "ready":
      return { state: "ready", message: null };
    case "starting":
    case "restarting":
    case "stopping":
      return {
        state: "checking",
        message: describeHostRuntimeUnavailable(runtime.label, status.state, status.failure),
      };
    case "disabled":
    case "error":
      return {
        state: "blocked",
        message: describeHostRuntimeUnavailable(runtime.label, status.state, status.failure),
      };
  }
};
