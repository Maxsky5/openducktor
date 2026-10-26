import type { RuntimeKind } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { RuntimeAdmissionPort } from "../../ports/runtime-admission-port";
import type { WithProcessStartAdmission } from "../workspaces/workspace-admission-service";

export const createLiveSessionStartAdmission =
  (
    runtimeAdmission: RuntimeAdmissionPort,
    withProcessStartAdmission: WithProcessStartAdmission | undefined,
  ) =>
  <Input extends { repoPath: string; runtimeKind: RuntimeKind }, Success>(
    operation: (input: Input) => Effect.Effect<Success, HostError>,
  ) =>
  (input: Input): Effect.Effect<Success, HostError> => {
    const admitted = runtimeAdmission.admit(input.runtimeKind, operation(input));
    return withProcessStartAdmission
      ? withProcessStartAdmission(input.repoPath, admitted)
      : admitted;
  };
