import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import type {
  DevServerService,
  DisposableDevServerService,
} from "../dev-servers/dev-server-service-types";

const devServerInput = (ref: WorkspaceSessionRefInput & { repoPath: string }) => ({
  repoPath: ref.repoPath,
  owner: {
    kind: "workspace_session" as const,
    workspaceId: ref.workspaceId,
    sessionId: ref.sessionId,
  },
});

export const stopWorkspaceSessionDevServers = (
  devServerService: Pick<DevServerService, "stopWorkspaceSession">,
  ref: WorkspaceSessionRefInput & { repoPath: string },
) => devServerService.stopWorkspaceSession(devServerInput(ref));

export const forgetWorkspaceSessionDevServers = (
  devServerService: Pick<DisposableDevServerService, "forgetWorkspaceSession">,
  ref: WorkspaceSessionRefInput & { repoPath: string },
) => devServerService.forgetWorkspaceSession(devServerInput(ref));
