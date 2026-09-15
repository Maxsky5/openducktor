import type { RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole } from "@openducktor/core";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import {
  pickRepoAgentDefault,
  type RepoAgentDefaultDraft,
  type RuntimeBoundModelSelection,
} from "@/lib/repo-agent-defaults";
import {
  missingSessionDefaultModelError,
  unavailableSessionDefaultCatalogError,
  unavailableSessionDefaultModelError,
} from "@/lib/session-start-errors";
import { coerceVisibleSelectionToCatalog } from "@/features/model-selection/model-selection-state";
import type { RepoSettingsInput } from "@/types/state-slices";

export {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/model-selection/model-selection-state";

const toAgentModelSelection = (value: RepoAgentDefaultDraft): RuntimeBoundModelSelection | null => {
  if (!value.providerId || !value.modelId || !value.runtimeKind) {
    return null;
  }

  const selection: RuntimeBoundModelSelection = {
    runtimeKind: value.runtimeKind,
    providerId: value.providerId,
    modelId: value.modelId,
  };
  if (value.variant) {
    selection.variant = value.variant;
  }
  if (value.profileId) {
    selection.profileId = value.profileId;
  }
  return selection;
};

export const roleDefaultSelectionFor = (
  repoSettings: RepoSettingsInput | null,
  role: AgentRole,
): RuntimeBoundModelSelection | null => {
  const roleDefault = repoSettings?.agentDefaults[role];
  return roleDefault ? toAgentModelSelection(roleDefault) : null;
};

export const repoDefaultModelSelectionFor = (
  repoSettings: RepoSettingsInput | null,
): RuntimeBoundModelSelection | null => {
  const defaultModel = repoSettings?.defaultModel;
  return defaultModel ? toAgentModelSelection(defaultModel) : null;
};

export const defaultSessionSelectionFor = (
  repoSettings: RepoSettingsInput | null,
  role: AgentRole,
): RuntimeBoundModelSelection | null =>
  pickRepoAgentDefault(
    roleDefaultSelectionFor(repoSettings, role),
    repoDefaultModelSelectionFor(repoSettings),
  );

export const resolveRequiredDefaultSessionSelection = async ({
  role,
  repoSettings,
  repoPath,
  loadRepoRuntimeCatalog,
}: {
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  repoPath: string;
  loadRepoRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
}): Promise<RuntimeBoundModelSelection> => {
  const savedDefaultSelection = defaultSessionSelectionFor(repoSettings, role);
  if (!savedDefaultSelection) {
    throw new Error(missingSessionDefaultModelError(role));
  }

  const runtimeKind = savedDefaultSelection.runtimeKind;
  let catalog: AgentModelCatalog;
  try {
    catalog = await loadRepoRuntimeCatalog({ repoPath, runtimeKind });
  } catch (cause) {
    throw new Error(
      unavailableSessionDefaultCatalogError({
        role,
        runtimeKind,
        causeDetail: errorMessage(cause),
      }),
      { cause },
    );
  }
  const validatedSelection = coerceVisibleSelectionToCatalog(catalog, savedDefaultSelection);
  if (!validatedSelection) {
    throw new Error(unavailableSessionDefaultModelError({ role, runtimeKind }));
  }
  return { ...validatedSelection, runtimeKind };
};

export const availableDefaultSessionSelectionFor = ({
  repoSettings,
  role,
  runtimeDefinitions,
}: {
  repoSettings: RepoSettingsInput | null;
  role: AgentRole;
  runtimeDefinitions: RuntimeDescriptor[];
}): RuntimeBoundModelSelection | null => {
  const selection = defaultSessionSelectionFor(repoSettings, role);
  if (!selection) {
    return null;
  }

  return findRuntimeDefinition(runtimeDefinitions, selection.runtimeKind) ? selection : null;
};
