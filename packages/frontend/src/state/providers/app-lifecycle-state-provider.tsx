import type { PropsWithChildren, ReactElement } from "react";
import { useRuntimeCatalogBootstrap } from "@/state/lifecycle/use-runtime-catalog-bootstrap";
import { useHostTaskStreamControllerFactory } from "@openducktor/frontend-core/tasks/use-host-task-stream";
import {
  useRequiredContext,
  useRuntimeAvailabilityContext,
  useTaskControlContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  useChecksOperationsContext,
  useWorkspaceOperationsContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { useHostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useAppLifecycle } from "../lifecycle/use-app-lifecycle";

export function AppLifecycleStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace, workspaces } = useRequiredContext(
    WorkspaceStateContext,
    "AppLifecycleStateProvider",
  );
  const { refreshBranches, clearBranchData } = useWorkspaceOperationsContext();
  const { availableRuntimeDefinitions, loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const { refreshTaskStoreCheckForRepo } = useChecksOperationsContext();
  const { loadWorkspaceTasks } = useTaskControlContext();
  const taskStreamControllerFactory = useHostTaskStreamControllerFactory();

  useRuntimeCatalogBootstrap({
    activeWorkspace,
    availableRuntimeDefinitions,
    runtimeStatus,
    loadRepoRuntimeCatalog,
  });

  useAppLifecycle({
    activeWorkspace,
    openWorkspaces: workspaces,
    refreshBranches,
    refreshTaskStoreCheckForRepo,
    loadWorkspaceTasks,
    clearBranchData,
    taskStreamControllerFactory,
  });

  return <>{children}</>;
}
