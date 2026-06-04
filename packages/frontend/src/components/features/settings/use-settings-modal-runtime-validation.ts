import type {
  RepoConfig,
  RuntimeDescriptor,
  RuntimeKind,
  SettingsSnapshot,
} from "@openducktor/contracts";
import { useMemo } from "react";
import { getAvailableRuntimeDefinitions, runtimeLabelFor } from "@/lib/agent-runtime";
import { ROLE_DEFAULTS } from "./settings-modal-model";

export type RuntimeAvailabilityValidationState = {
  errorsByWorkspaceId: Record<string, string[]>;
  errorCountByWorkspaceId: Record<string, number>;
  totalErrorCount: number;
};

const EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE: RuntimeAvailabilityValidationState = {
  errorsByWorkspaceId: {},
  errorCountByWorkspaceId: {},
  totalErrorCount: 0,
};

const findAvailableRuntimeKind = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind,
): RuntimeKind | null =>
  runtimeDefinitions.some((definition) => definition.kind === runtimeKind) ? runtimeKind : null;

const unavailableRuntimeLabel = (
  allRuntimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind,
): string =>
  runtimeLabelFor({
    runtimeDefinitions: allRuntimeDefinitions,
    runtimeKind,
  });

const buildRepoRuntimeAvailabilityErrors = ({
  allRuntimeDefinitions,
  availableRuntimeDefinitions,
  repoConfig,
}: {
  allRuntimeDefinitions: RuntimeDescriptor[];
  availableRuntimeDefinitions: RuntimeDescriptor[];
  repoConfig: RepoConfig;
}): string[] => {
  const errors: string[] = [];
  if (!findAvailableRuntimeKind(availableRuntimeDefinitions, repoConfig.defaultRuntimeKind)) {
    errors.push(
      `Default agent runtime "${unavailableRuntimeLabel(allRuntimeDefinitions, repoConfig.defaultRuntimeKind)}" is disabled.`,
    );
  }

  for (const { role, label } of ROLE_DEFAULTS) {
    const roleDefault = repoConfig.agentDefaults[role];
    const runtimeKind = roleDefault?.runtimeKind;
    if (!runtimeKind) {
      continue;
    }
    if (findAvailableRuntimeKind(availableRuntimeDefinitions, runtimeKind)) {
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
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  snapshotDraft: SettingsSnapshot;
}): RuntimeAvailabilityValidationState => {
  if (runtimeDefinitions.length === 0) {
    return EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE;
  }

  const availableRuntimeDefinitions = getAvailableRuntimeDefinitions({
    runtimeDefinitions,
    agentRuntimes: snapshotDraft.agentRuntimes,
  });
  let totalErrorCount = 0;
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
    totalErrorCount += errors.length;
  }

  return {
    errorsByWorkspaceId,
    errorCountByWorkspaceId,
    totalErrorCount,
  };
};

export const useSettingsModalRuntimeValidation = ({
  runtimeDefinitions,
  snapshotDraft,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  snapshotDraft: SettingsSnapshot | null;
}): RuntimeAvailabilityValidationState => {
  return useMemo(() => {
    if (!snapshotDraft) {
      return EMPTY_RUNTIME_AVAILABILITY_VALIDATION_STATE;
    }
    return buildRuntimeAvailabilityValidationState({
      runtimeDefinitions,
      snapshotDraft,
    });
  }, [runtimeDefinitions, snapshotDraft]);
};
