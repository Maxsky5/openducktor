import type {
  SettingsRepoConfig,
  RuntimeDescriptor,
  RuntimeKind,
  SettingsSnapshot,
} from "@openducktor/contracts";
import { useMemo } from "react";
import { getAvailableRuntimeDefinitions, runtimeLabelFor } from "@/lib/agent-runtime";
import { runtimeExecutableResultForPath } from "@/state/operations/runtime-executables/runtime-executable-validation";
import type { RuntimeExecutableValidationResult } from "@/state/queries/use-runtime-executable-validation";
import { ROLE_DEFAULTS } from "./settings-modal-model";

export type RuntimeAvailabilityValidationState = {
  errorsByWorkspaceId: Record<string, string[]>;
  errorCountByWorkspaceId: Record<string, number>;
  runtimeExecutableErrors: string[];
  totalErrorCount: number;
};

const EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE: RuntimeAvailabilityValidationState = {
  errorsByWorkspaceId: {},
  errorCountByWorkspaceId: {},
  runtimeExecutableErrors: [],
  totalErrorCount: 0,
};

const unavailableRuntimeLabel = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind,
): string => runtimeLabelFor({ runtimeDefinitions, runtimeKind });

const buildRepoRuntimeAvailabilityErrors = ({
  allRuntimeDefinitions,
  availableRuntimeDefinitions,
  repoConfig,
}: {
  allRuntimeDefinitions: RuntimeDescriptor[];
  availableRuntimeDefinitions: RuntimeDescriptor[];
  repoConfig: SettingsRepoConfig;
}): string[] => {
  const errors: string[] = [];
  const availableKinds = new Set(availableRuntimeDefinitions.map(({ kind }) => kind));
  if (availableKinds.size === 0) return errors;
  if (!availableKinds.has(repoConfig.defaultRuntimeKind)) {
    errors.push(
      `Default agent runtime "${unavailableRuntimeLabel(allRuntimeDefinitions, repoConfig.defaultRuntimeKind)}" is disabled.`,
    );
  }

  for (const { role, label } of ROLE_DEFAULTS) {
    const runtimeKind = repoConfig.agentDefaults[role]?.runtimeKind;
    if (!runtimeKind || availableKinds.has(runtimeKind)) {
      continue;
    }
    errors.push(
      `${label} agent runtime "${unavailableRuntimeLabel(allRuntimeDefinitions, runtimeKind)}" is disabled.`,
    );
  }
  return errors;
};

export const buildRuntimeAvailabilityValidationState = ({
  runtimeDefinitions,
  snapshotDraft,
  runtimeExecutableResults,
  checkingRuntimeKinds = [],
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  snapshotDraft: SettingsSnapshot;
  runtimeExecutableResults?: RuntimeExecutableValidationResult[];
  checkingRuntimeKinds?: readonly RuntimeKind[];
}): RuntimeAvailabilityValidationState => {
  if (runtimeDefinitions.length === 0) {
    return EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE;
  }

  const availableRuntimeDefinitions = getAvailableRuntimeDefinitions({
    runtimeDefinitions,
    agentRuntimes: snapshotDraft.agentRuntimes,
  });
  let workspaceErrorCount = 0;
  const errorsByWorkspaceId: Record<string, string[]> = {};
  const errorCountByWorkspaceId: Record<string, number> = {};
  for (const [workspaceId, repoConfig] of Object.entries(snapshotDraft.workspaces)) {
    const errors = buildRepoRuntimeAvailabilityErrors({
      allRuntimeDefinitions: runtimeDefinitions,
      availableRuntimeDefinitions,
      repoConfig,
    });
    if (errors.length === 0) {
      continue;
    }
    errorsByWorkspaceId[workspaceId] = errors;
    errorCountByWorkspaceId[workspaceId] = errors.length;
    workspaceErrorCount += errors.length;
  }

  const checkingRuntimeKindSet = new Set(checkingRuntimeKinds);
  const runtimeExecutableErrors = runtimeExecutableResults
    ? runtimeDefinitions.flatMap((definition) => {
        if (!snapshotDraft.agentRuntimes[definition.kind].enabled) return [];
        const result = runtimeExecutableResultForPath(
          definition.kind,
          snapshotDraft.agentRuntimes[definition.kind].executablePath,
          runtimeExecutableResults,
        );
        if (!result && checkingRuntimeKindSet.has(definition.kind)) return [];
        if (result?.ok) return [];
        return [result?.error ?? `${definition.label} needs a valid executable path.`];
      })
    : [];
  return {
    errorsByWorkspaceId,
    errorCountByWorkspaceId,
    runtimeExecutableErrors,
    totalErrorCount: workspaceErrorCount + runtimeExecutableErrors.length,
  };
};

export const useSettingsModalRuntimeValidation = ({
  runtimeDefinitions,
  snapshotDraft,
  runtimeExecutableResults,
  checkingRuntimeKinds,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  snapshotDraft: SettingsSnapshot | null;
  runtimeExecutableResults?: RuntimeExecutableValidationResult[];
  checkingRuntimeKinds?: readonly RuntimeKind[];
}): RuntimeAvailabilityValidationState => {
  return useMemo(() => {
    if (!snapshotDraft) {
      return EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE;
    }
    const validationInput: Parameters<typeof buildRuntimeAvailabilityValidationState>[0] = {
      runtimeDefinitions,
      snapshotDraft,
    };
    if (runtimeExecutableResults)
      validationInput.runtimeExecutableResults = runtimeExecutableResults;
    if (checkingRuntimeKinds) {
      validationInput.checkingRuntimeKinds = checkingRuntimeKinds;
    }
    return buildRuntimeAvailabilityValidationState(validationInput);
  }, [checkingRuntimeKinds, runtimeDefinitions, runtimeExecutableResults, snapshotDraft]);
};
