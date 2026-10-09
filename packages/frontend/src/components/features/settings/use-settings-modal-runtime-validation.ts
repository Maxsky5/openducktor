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
  warningsByWorkspaceId: Record<string, string[]>;
  runtimeExecutableErrors: string[];
  totalErrorCount: number;
};

const EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE: RuntimeAvailabilityValidationState = {
  warningsByWorkspaceId: {},
  runtimeExecutableErrors: [],
  totalErrorCount: 0,
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
  const warningsByWorkspaceId: Record<string, string[]> = {};
  for (const [workspaceId, repoConfig] of Object.entries(snapshotDraft.workspaces)) {
    const warnings = getRepoWarnings({
      allRuntimeDefinitions: runtimeDefinitions,
      availableRuntimeDefinitions,
      repoConfig,
    });
    if (warnings.length === 0) {
      continue;
    }
    warningsByWorkspaceId[workspaceId] = warnings;
  }

  const checkingKinds = new Set(checkingRuntimeKinds);
  const runtimeExecutableErrors = runtimeExecutableResults
    ? runtimeDefinitions.flatMap((definition) => {
        if (!snapshotDraft.agentRuntimes[definition.kind].enabled) return [];
        const result = runtimeExecutableResultForPath(
          definition.kind,
          snapshotDraft.agentRuntimes[definition.kind].executablePath,
          runtimeExecutableResults,
        );
        if (!result && checkingKinds.has(definition.kind)) return [];
        if (result?.ok) return [];
        return [result?.error ?? `${definition.label} needs a valid executable path.`];
      })
    : [];
  return {
    warningsByWorkspaceId,
    runtimeExecutableErrors,
    totalErrorCount: runtimeExecutableErrors.length,
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
    const input: Parameters<typeof buildRuntimeAvailabilityValidationState>[0] = {
      runtimeDefinitions,
      snapshotDraft,
    };
    if (runtimeExecutableResults) input.runtimeExecutableResults = runtimeExecutableResults;
    if (checkingRuntimeKinds) {
      input.checkingRuntimeKinds = checkingRuntimeKinds;
    }
    return buildRuntimeAvailabilityValidationState(input);
  }, [checkingRuntimeKinds, runtimeDefinitions, runtimeExecutableResults, snapshotDraft]);
};

const getRepoWarnings = ({
  allRuntimeDefinitions,
  availableRuntimeDefinitions,
  repoConfig,
}: {
  allRuntimeDefinitions: RuntimeDescriptor[];
  availableRuntimeDefinitions: RuntimeDescriptor[];
  repoConfig: SettingsRepoConfig;
}): string[] => {
  const warnings: string[] = [];
  const availableKinds = new Set(availableRuntimeDefinitions.map(({ kind }) => kind));
  const defaultModelRuntimeKind = repoConfig.defaultModel?.runtimeKind;
  if (defaultModelRuntimeKind && !availableKinds.has(defaultModelRuntimeKind)) {
    warnings.push(
      `Default Model runtime "${runtimeLabelFor({ runtimeDefinitions: allRuntimeDefinitions, runtimeKind: defaultModelRuntimeKind })}" is disabled.`,
    );
  }

  for (const { role, label } of ROLE_DEFAULTS) {
    const runtimeKind = repoConfig.agentDefaults[role]?.runtimeKind;
    if (!runtimeKind || availableKinds.has(runtimeKind)) {
      continue;
    }
    warnings.push(
      `${label} agent runtime "${runtimeLabelFor({ runtimeDefinitions: allRuntimeDefinitions, runtimeKind })}" is disabled.`,
    );
  }
  return warnings;
};
