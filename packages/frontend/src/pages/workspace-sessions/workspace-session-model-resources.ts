import type {
  AgentModelCatalog,
  AgentModelSelection,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import {
  toModelPickerCatalogResource,
  unavailableModelPickerCatalogResource,
  type ModelPickerRuntime,
} from "@/components/features/agents/model-picker";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type SessionModelTarget = {
  identity: AgentSessionIdentity | null;
  runtimeKind?: AgentSessionIdentity["runtimeKind"];
  runtimeRef?: RuntimeWorkingDirectoryRef;
  updateDraft?: (selection: AgentModelSelection | null) => void;
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

export function projectWorkspaceModelResources(
  definitions: readonly ModelPickerRuntime["descriptor"][],
  availableDefinitions: readonly ModelPickerRuntime["descriptor"][],
  resources: readonly RuntimeModelCatalogQueryResource[],
  selection: AgentModelSelection | null,
  session?: SessionModelTarget,
) {
  const availableKinds = new Set(availableDefinitions.map((definition) => definition.kind));
  const sessionRuntimeKind = session?.identity?.runtimeKind ?? session?.runtimeKind;
  const runtimeKind = sessionRuntimeKind ?? selection?.runtimeKind ?? null;
  const catalog = session
    ? session.catalog
    : (resources.find((resource) => resource.runtimeKind === runtimeKind)?.catalog ?? null);
  const runtimes: ModelPickerRuntime[] = definitions.map((descriptor) => {
    if (session) {
      return {
        descriptor,
        isEnabledForFavorites: availableKinds.has(descriptor.kind),
        resource:
          descriptor.kind === sessionRuntimeKind
            ? toModelPickerCatalogResource({
                catalog: session.catalog,
                isFetching: session.isLoading,
                error: session.error,
                isAvailable: true,
                unavailableReason: "Session model catalog is unavailable.",
                retry: session.retry,
              })
            : unavailableModelPickerCatalogResource("Start a new session to use another runtime."),
      };
    }
    const resource = resources.find((entry) => entry.runtimeKind === descriptor.kind);
    return {
      descriptor,
      isEnabledForFavorites: availableKinds.has(descriptor.kind),
      resource: resource
        ? toModelPickerCatalogResource({
            catalog: resource.catalog,
            isFetching: resource.isFetching,
            error: resource.error,
            isAvailable: resource.isEnabled,
            unavailableReason: "Runtime catalog is unavailable.",
            retry: resource.retry,
          })
        : unavailableModelPickerCatalogResource("Runtime catalog is unavailable."),
    };
  });
  return {
    runtimes,
    catalog,
    runtimeKind,
    sessionRuntimeKind,
    supportsProfiles:
      definitions.find((entry) => entry.kind === runtimeKind)?.capabilities.optionalSurfaces
        .supportsProfiles ?? false,
    isLoading: session
      ? session.isLoading && session.catalog === null
      : resources.some((entry) => entry.isFetching && entry.catalog === null),
  };
}
