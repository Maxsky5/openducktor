import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  buildDiagnosticsPanelModel,
  type DiagnosticsPanelModel,
} from "@openducktor/frontend-core/diagnostics/diagnostics-panel-model";
import { useDiagnosticsChecks } from "@openducktor/frontend-core/diagnostics/use-diagnostics-checks";
import { useHostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useMemo } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { useCommandGate } from "@/host-session/active-session-context";

export type DiagnosticsScreenModel = {
  model: DiagnosticsPanelModel;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
};

/**
 * The desktop diagnostics model for the host of this connection and the workspace that this app
 * shows. It only reads checks; host settings stay in the desktop and web apps.
 */
export function useDiagnosticsModel(): DiagnosticsScreenModel {
  const { allRuntimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const { selectedWorkspace } = useMobileWorkspaces();
  const connectionLive = useCommandGate().open;
  const checks = useDiagnosticsChecks({
    activeWorkspace: selectedWorkspace,
    refreshHostRuntimeStatus: runtimeStatus.refresh,
  });
  const { pathCheck, gitCheck, checksRepoPath, taskStoreCheck } = checks;
  const model = useMemo(
    () =>
      buildDiagnosticsPanelModel({
        connectionLive,
        runtimeDefinitions: allRuntimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
        runtimeStatus,
        pathCheck,
        gitCheck,
        workspace: selectedWorkspace,
        checksRepoPath,
        taskStoreCheck,
      }),
    [
      allRuntimeDefinitions,
      checksRepoPath,
      connectionLive,
      gitCheck,
      isLoadingRuntimeDefinitions,
      pathCheck,
      runtimeDefinitionsError,
      runtimeStatus,
      selectedWorkspace,
      taskStoreCheck,
    ],
  );
  return { model, isRefreshing: checks.isRefreshingChecks, refresh: checks.refreshChecks };
}
