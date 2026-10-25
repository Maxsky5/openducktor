import { type ComponentType, createElement, type PropsWithChildren } from "react";
import { ActiveWorkspaceContext } from "../app-state/app-state-contexts";
import type { ClientConnection } from "../connection/client-connection";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import type { ActiveWorkspace } from "../types/session-slices";

export const TEST_ACTIVE_WORKSPACE: ActiveWorkspace = {
  workspaceId: "workspace-a",
  workspaceName: "Workspace A",
  repoPath: "/repo",
};

/** A test wrapper with a client connection and a fixed active workspace. */
export const createActiveWorkspaceWrapper = (
  connection: ClientConnection,
  activeWorkspace: ActiveWorkspace | null = TEST_ACTIVE_WORKSPACE,
): ComponentType<PropsWithChildren> => {
  const value = { activeWorkspace, setActiveWorkspace: () => {} };
  return function ActiveWorkspaceWrapper({ children }: PropsWithChildren) {
    return createElement(
      ClientConnectionProvider,
      { connection },
      createElement(ActiveWorkspaceContext.Provider, { value }, children),
    );
  };
};
