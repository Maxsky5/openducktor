import type { RuntimeDescriptor } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentModelSelection,
  type AgentRuntimeCatalog,
  coerceVisibleSelectionToCatalog,
  type RuntimeWorkingDirectoryRef,
  STANDARD_SPEED,
} from "@openducktor/core";
import { resolveRuntimeCatalogSurface } from "../queries/runtime-catalog";
import { findRuntimeDefinition } from "../lib/agent-runtime";
import { errorMessage } from "../lib/errors";
import {
  pickRepoAgentDefault,
  type RepoAgentDefaultDraft,
  type RuntimeBoundModelSelection,
} from "../lib/repo-agent-defaults";
import {
  missingSessionDefaultModelError,
  unavailableSessionDefaultCatalogError,
  unavailableSessionDefaultModelError,
} from "../lib/session-start-errors";
import type { RepoSettingsInput } from "../types/session-slices";
import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";

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
  if (value.speed && value.speed !== STANDARD_SPEED) {
    selection.speed = value.speed;
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
  roleLabel,
  repoSettings,
  repoPath,
  loadRepoRuntimeCatalog,
}: {
  role: AgentRole;
  roleLabel: string;
  repoSettings: RepoSettingsInput | null;
  repoPath: string;
  loadRepoRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
}): Promise<RuntimeBoundModelSelection> => {
  const savedDefaultSelection = defaultSessionSelectionFor(repoSettings, role);
  if (!savedDefaultSelection) {
    throw new Error(missingSessionDefaultModelError(roleLabel));
  }

  const runtimeKind = savedDefaultSelection.runtimeKind;
  let catalog: AgentModelCatalog;
  try {
    const runtimeCatalog = await loadRepoRuntimeCatalog({
      repoPath,
      runtimeKind,
      workingDirectory: repoPath,
    });
    const modelSurface = resolveRuntimeCatalogSurface(runtimeCatalog.models, null);
    if (modelSurface.catalog === null) {
      throw new Error(modelSurface.error ?? `Runtime '${runtimeKind}' returned no model catalog.`);
    }
    catalog = modelSurface.catalog;
  } catch (cause) {
    throw new Error(
      unavailableSessionDefaultCatalogError({
        role: roleLabel,
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
    throw new Error(unavailableSessionDefaultModelError({ role: roleLabel, runtimeKind }));
  }
  if (savedDefaultSelection.speed !== undefined) {
    if (validatedSelection.speed !== savedDefaultSelection.speed) {
      throw new Error(
        `The saved ${roleLabel} default speed '${savedDefaultSelection.speed}' is not supported by model '${validatedSelection.providerId}/${validatedSelection.modelId}' on runtime ${runtimeKind}. Update it in Settings > Repositories > Agents.`,
      );
    }
    if (catalog.speedAvailability?.status === "blocked") {
      throw new Error(
        `The saved ${roleLabel} default speed '${savedDefaultSelection.speed}' cannot be used on runtime ${runtimeKind}: ${catalog.speedAvailability.reason.message} Update it in Settings > Repositories > Agents.`,
      );
    }
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
