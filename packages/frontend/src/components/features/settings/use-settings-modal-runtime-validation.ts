import type {
  RuntimeDescriptor,
  RuntimeExecutableCheckResult,
  SettingsSnapshot,
} from "@openducktor/contracts";
import { useMemo } from "react";
import { runtimeExecutableResultForPath } from "./runtime-executable-validation";

export type RuntimeAvailabilityValidationState = {
  runtimeExecutableErrors: string[];
  totalErrorCount: number;
};

const EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE: RuntimeAvailabilityValidationState = {
  runtimeExecutableErrors: [],
  totalErrorCount: 0,
};

export const buildRuntimeAvailabilityValidationState = ({
  runtimeDefinitions,
  snapshotDraft,
  runtimeExecutableResults,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  snapshotDraft: SettingsSnapshot;
  runtimeExecutableResults?: RuntimeExecutableCheckResult[];
}): RuntimeAvailabilityValidationState => {
  if (runtimeDefinitions.length === 0) {
    return EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE;
  }

  const runtimeExecutableErrors = runtimeExecutableResults
    ? runtimeDefinitions.flatMap((definition) => {
        if (!snapshotDraft.agentRuntimes[definition.kind].enabled) return [];
        const result = runtimeExecutableResultForPath(
          definition.kind,
          snapshotDraft.agentRuntimes[definition.kind].executablePath,
          runtimeExecutableResults,
        );
        if (result?.ok) return [];
        return [result?.error ?? `${definition.label} needs a valid executable path.`];
      })
    : [];
  return {
    runtimeExecutableErrors,
    totalErrorCount: runtimeExecutableErrors.length,
  };
};

export const useSettingsModalRuntimeValidation = ({
  runtimeDefinitions,
  snapshotDraft,
  runtimeExecutableResults,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  snapshotDraft: SettingsSnapshot | null;
  runtimeExecutableResults?: RuntimeExecutableCheckResult[];
}): RuntimeAvailabilityValidationState => {
  return useMemo(() => {
    if (!snapshotDraft) {
      return EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE;
    }
    return buildRuntimeAvailabilityValidationState({
      runtimeDefinitions,
      snapshotDraft,
      ...(runtimeExecutableResults ? { runtimeExecutableResults } : {}),
    });
  }, [runtimeDefinitions, runtimeExecutableResults, snapshotDraft]);
};
