import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import type { DevServerService } from "../dev-servers/dev-server-service-types";

export const stopWorkspaceSessionDevServers = (
  devServerService: Pick<DevServerService, "stopWorkspaceSession">,
  ref: WorkspaceSessionRefInput & { repoPath: string },
) =>
  devServerService.stopWorkspaceSession({
    repoPath: ref.repoPath,
    owner: {
      kind: "workspace_session",
      workspaceId: ref.workspaceId,
      sessionId: ref.sessionId,
    },
  });
