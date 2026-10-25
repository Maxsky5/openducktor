import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useRuntimeModelCatalogs } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import { useMemo } from "react";
import { useMobileWorkspaces } from "./workspace-selection";

/**
 * Keeps the model catalogs of the selected workspace loaded from the moment the app connects. A
 * session in any folder of the workspace then shows its model names from its first frame, also
 * when a notification opens it right after the app starts.
 */
export function WorkspaceModelCatalogs(): null {
  const { selectedWorkspace } = useMobileWorkspaces();
  const { availableRuntimeDefinitions, loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const runtimeKinds = useMemo(
    () => availableRuntimeDefinitions.map((definition) => definition.kind),
    [availableRuntimeDefinitions],
  );
  useRuntimeModelCatalogs({
    repoPath: selectedWorkspace?.repoPath ?? null,
    runtimeKinds,
    enabledRuntimeKinds: runtimeKinds,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
  });
  return null;
}
