import {
  type AgentModelFavorite,
  type RepoConfig,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { RuntimeModelCatalogResource } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import type { useWorkspaceSessionCreateModel } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create-model";
import type { WorkspaceSessionDraftModelReadiness } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-draft-core";
import type { UseQueryResult } from "@tanstack/react-query";

/** The state of the model of a new chat. */
type NewChatModelState =
  | { kind: "loading" }
  | { kind: "ready" }
  /** The repository has no Default Model and the user chose no model. */
  | { kind: "no_default" }
  /** The repository settings, which hold the Default Model, did not load. */
  | { kind: "settings_failed"; message: string }
  /** The selected model is not in the catalog of its runtime. */
  | { kind: "not_in_catalog"; modelLabel: string; runtimeLabel: string }
  | { kind: "catalog_failed"; message: string }
  /**
   * The runtime of the selected model is not available on the host. The reason says why the host
   * cannot use it, such as a runtime that failed to start.
   */
  | { kind: "runtime_unavailable"; runtimeLabel: string; reason: string | null };

export type RepoSettingsRead = {
  pending: boolean;
  error: string | null;
};

type WorkspaceSessionCreateModel = ReturnType<typeof useWorkspaceSessionCreateModel>;

type NewChatModelStateInput = {
  /** The model that the user chose, or the Default Model checked against its catalog. */
  selection: AgentModelSelection | null;
  /** The repository Default Model, as the settings store it. */
  defaultSelection: AgentModelSelection | null;
  /** The read of the repository settings, which hold the Default Model. */
  repoSettings: RepoSettingsRead;
  /** The runtime of the selection, else of the Default Model. */
  runtimeKind: RuntimeKind | null;
  /** The runtimes that a new chat can use. */
  runtimeKinds: readonly RuntimeKind[];
  /** The model catalog read of `runtimeKind`. */
  resource: Pick<
    RuntimeModelCatalogResource,
    "catalog" | "isLoading" | "error" | "unavailableReason"
  > | null;
  /** True when the catalog has the selected model. */
  selectedModelFound: boolean;
};

/** The state of the model of a new chat, which decides if Send can start the chat. */
const newChatModelState = ({
  selection,
  defaultSelection,
  repoSettings,
  runtimeKind,
  runtimeKinds,
  resource,
  selectedModelFound,
}: NewChatModelStateInput): NewChatModelState => {
  if (!selection && repoSettings.pending) return { kind: "loading" };
  if (!selection && repoSettings.error) {
    return { kind: "settings_failed", message: repoSettings.error };
  }
  if (!selection && !defaultSelection) return { kind: "no_default" };
  const runtimeLabel = runtimeKind ? RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].label : "runtime";
  if (runtimeKind !== null && !runtimeKinds.includes(runtimeKind)) {
    return { kind: "runtime_unavailable", runtimeLabel, reason: null };
  }
  if (!resource || resource.isLoading) return { kind: "loading" };
  if (!resource.catalog && resource.unavailableReason) {
    return { kind: "runtime_unavailable", runtimeLabel, reason: resource.unavailableReason };
  }
  if (resource.error && !resource.catalog) {
    return { kind: "catalog_failed", message: resource.error };
  }
  if (selectedModelFound) return { kind: "ready" };
  const missing = selection ?? defaultSelection;
  return {
    kind: "not_in_catalog",
    modelLabel: missing ? missing.modelId : "The Default Model",
    runtimeLabel,
  };
};

const newChatModelError = (model: NewChatModelState): string | null => {
  switch (model.kind) {
    case "no_default":
      return "This repository has no Default Model. Choose a model, or set a Default Model in the repository settings on the host.";
    case "settings_failed":
      return `The repository settings did not load, so the Default Model is unknown. ${model.message} Choose a model or retry loading settings.`;
    case "not_in_catalog":
      return `${model.modelLabel} is not in the ${model.runtimeLabel} model catalog. Choose another model.`;
    case "catalog_failed":
      return `The model catalog could not load. ${model.message}`;
    case "runtime_unavailable":
      return model.reason
        ? `${model.reason} Or choose a model of another runtime.`
        : `The ${model.runtimeLabel} runtime is not available on the host. Choose a model of another runtime.`;
    default:
      return null;
  }
};

export type NewChatModel = WorkspaceSessionCreateModel & {
  /** What the model allows: Send starts the chat only for a ready model. */
  state: NewChatModelState;
  /** Mobile-specific error copy when the model is not ready, or null. */
  error: string | null;
  /** The favorite models of the host, which the model picker shows first. */
  favorites: AgentModelFavorite[] | null;
};

/** Resolves mobile's rich model readiness state from the shared create-model controller. */
function resolveNewChatModelState(
  model: WorkspaceSessionCreateModel,
  defaultSelection: AgentModelSelection | null,
  repoSettings: RepoSettingsRead,
): NewChatModelState {
  // Until the Default Model is checked against its catalog, the state reads that catalog.
  const runtimeKind = model.runtimeKind ?? defaultSelection?.runtimeKind ?? null;
  return newChatModelState({
    selection: model.selection,
    defaultSelection,
    repoSettings,
    runtimeKind,
    runtimeKinds: model.runtimeKinds,
    resource: model.resources.find((entry) => entry.runtimeKind === runtimeKind) ?? null,
    selectedModelFound: model.selectedModelEntry !== null,
  });
}

/** Adapter passed to `useWorkspaceSessionDraftCore`'s `resolveModelReadiness`. */
export function resolveNewChatModelReadiness({
  model,
  defaultModelSelection,
  repoConfig,
}: {
  model: WorkspaceSessionCreateModel;
  defaultModelSelection: AgentModelSelection | null;
  repoConfig: UseQueryResult<RepoConfig>;
}): WorkspaceSessionDraftModelReadiness {
  const state = resolveNewChatModelState(model, defaultModelSelection, {
    pending: repoConfig.isPending,
    error: repoConfig.error ? errorMessage(repoConfig.error) : null,
  });
  return {
    available: state.kind === "ready",
    isLoading: state.kind === "loading",
    error: newChatModelError(state),
  };
}

/** Wraps `useWorkspaceSessionDraftCore`'s model with mobile readiness state, error copy, and favorites. */
export function toNewChatModel(
  model: WorkspaceSessionCreateModel,
  defaultSelection: AgentModelSelection | null,
  repoSettings: RepoSettingsRead,
  favorites: AgentModelFavorite[] | null,
): NewChatModel {
  const state = resolveNewChatModelState(model, defaultSelection, repoSettings);
  return { ...model, state, error: newChatModelError(state), favorites };
}
