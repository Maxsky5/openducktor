import type { RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { resolveRuntimeCatalogSurface } from "@/state/queries/runtime-catalog";
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

const savedVariantAndProfileAreAvailable = (
  saved: RuntimeBoundModelSelection,
  validated: AgentModelSelection,
): boolean =>
  (saved.variant === undefined || validated.variant === saved.variant) &&
  (saved.profileId === undefined || validated.profileId === saved.profileId);

export const resolveRequiredDefaultSessionSelection = async ({
  role,
  repoSettings,
  repoPath,
  loadRepoRuntimeCatalog,
}: {
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  repoPath: string;
  loadRepoRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
}): Promise<RuntimeBoundModelSelection> => {
  const savedDefaultSelection = defaultSessionSelectionFor(repoSettings, role);
  if (!savedDefaultSelection) {
    throw new Error(missingSessionDefaultModelError(role));
  }

  const runtimeKind = savedDefaultSelection.runtimeKind;
  let catalog: AgentModelCatalog;
  try {
    const runtimeCatalog = await loadRepoRuntimeCatalog({
      repoPath,
      runtimeKind,
      workingDirectory: repoPath,
    });
    const models = resolveRuntimeCatalogSurface(runtimeCatalog.models, null).catalog;
    if (models === null) {
      throw new Error(`Runtime '${runtimeKind}' returned no model catalog.`);
    }
    catalog = models;
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
  if (
    !validatedSelection ||
    !savedVariantAndProfileAreAvailable(savedDefaultSelection, validatedSelection)
  ) {
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
