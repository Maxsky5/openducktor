import type {
  AgentModelCatalog,
  AgentModelSelection,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import {
  type ModelPickerRuntime,
  toModelPickerCatalogResource,
  unavailableModelPickerCatalogResource,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

export type SessionModelTarget = {
  identity: AgentSessionIdentity | null;
  runtimeKind?: AgentSessionIdentity["runtimeKind"];
  /** The runtime and directory of the catalog that the session uses. */
  runtimeRef: RuntimeWorkingDirectoryRef;
  updateDraft: (selection: AgentModelSelection | null) => void;
  /** Saves a speed change without the model lock, so the other controls keep their state. */
  updateSpeed?: (
    identity: AgentSessionIdentity | null,
    selection: AgentModelSelection,
  ) => Promise<void>;
  selection: AgentModelSelection | null;
  catalog: AgentModelCatalog | null;
  isLoading: boolean;
  error: string | null;
  retry: () => Promise<void>;
  update: (
    identity: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => Promise<void> | void;
};

/** The runtimes of the model picker of a chat. Only the runtime of its session has a catalog. */
export function projectWorkspaceModelResources(
  definitions: readonly ModelPickerRuntime["descriptor"][],
  availableDefinitions: readonly ModelPickerRuntime["descriptor"][],
  session: SessionModelTarget,
) {
  const availableKinds = new Set(availableDefinitions.map((definition) => definition.kind));
  const sessionRuntimeKind = session.identity?.runtimeKind ?? session.runtimeKind;
  const runtimeKind = sessionRuntimeKind ?? session.selection?.runtimeKind ?? null;
  const runtimes: ModelPickerRuntime[] = definitions.map((descriptor) => ({
    descriptor,
    isEnabledForFavorites: availableKinds.has(descriptor.kind),
    resource:
      descriptor.kind === sessionRuntimeKind
        ? toModelPickerCatalogResource({
            catalog: session.catalog,
            isLoading: session.isLoading,
            error: session.error,
            isAvailable: true,
            unavailableReason: "Session model catalog is unavailable.",
            retry: session.retry,
          })
        : unavailableModelPickerCatalogResource("Start a new session to use another runtime."),
  }));
  return {
    runtimes,
    catalog: session.catalog,
    runtimeKind,
    sessionRuntimeKind,
    supportsProfiles:
      definitions.find((entry) => entry.kind === runtimeKind)?.capabilities.optionalSurfaces
        .supportsProfiles ?? false,
    isLoading: session.isLoading,
  };
}
