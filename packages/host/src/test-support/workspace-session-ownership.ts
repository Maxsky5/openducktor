import type { WorkspaceCatalog } from "@openducktor/contracts";
import type {
  RuntimeOwnershipScope,
  WorkspaceSessionStoreScope,
} from "../ports/workspace-session-store-port";

export const workspaceSessionOwnership = (
  scope: WorkspaceSessionStoreScope,
): RuntimeOwnershipScope => ({
  catalogRevision: 0,
  workspaces: [scope],
});

export const workspaceSessionCatalog = (scope: WorkspaceSessionStoreScope): WorkspaceCatalog => ({
  catalogRevision: 0,
  openWorkspaces: [
    {
      ...scope,
      workspaceName: scope.workspaceId,
      abbreviation: null,
      tileColor: null,
      isActive: true,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: null,
      effectiveWorktreeBasePath: null,
    },
  ],
  closedWorkspaces: [],
  incompleteRemovals: [],
});
