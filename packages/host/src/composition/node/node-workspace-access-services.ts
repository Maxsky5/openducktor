import { createWorkspaceAdmissionService } from "../../application/workspaces/workspace-admission-service";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";

type NodeWorkspaceAccessPorts = Pick<
  NodeHostDefaultPorts,
  "git" | "settingsConfig" | "worktreeFiles" | "workspaceHostOwnership" | "workspaceOwnershipLock"
>;

export const createNodeWorkspaceAccessServices = ({
  git,
  settingsConfig,
  worktreeFiles,
  workspaceHostOwnership,
  workspaceOwnershipLock,
}: NodeWorkspaceAccessPorts) => {
  const workspaceSettingsService = createWorkspaceSettingsService(
    settingsConfig,
    workspaceOwnershipLock,
  );
  const ownedWorkspaceSettingsService = createWorkspaceSettingsService(
    settingsConfig,
    workspaceOwnershipLock,
    "already-held",
  );
  const workspaceAdmissionService = createWorkspaceAdmissionService({
    gitPort: git,
    hostOwnership: workspaceHostOwnership,
    settingsConfig,
    worktreeFiles,
    workspaceSettingsService,
  });
  return {
    ownedWorkspaceSettingsService,
    workspaceAdmissionService,
    workspaceSettingsService,
  };
};
