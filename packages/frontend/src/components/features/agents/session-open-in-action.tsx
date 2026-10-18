import type { SystemOpenInToolId } from "@openducktor/contracts";
import { type ReactElement, useCallback } from "react";
import { OpenInMenu } from "./agent-studio-git-panel/open-in-menu";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

export function SessionOpenInAction({
  contextMode,
  targetPath,
  disabledReason,
  targetLabel,
}: {
  contextMode: "repository" | "worktree";
  targetPath: string | null;
  disabledReason: string | null;
  targetLabel?: string;
}): ReactElement {
  const hostClient = useHostClient();
  const open = useCallback(
    async (toolId: SystemOpenInToolId) => {
      if (!targetPath) throw new Error("The session working directory is unavailable.");
      await hostClient.systemOpenDirectoryInTool(targetPath, toolId);
    },
    [hostClient, targetPath],
  );
  return (
    <OpenInMenu
      contextMode={contextMode}
      targetPath={targetPath}
      disabledReason={disabledReason}
      {...(targetLabel ? { targetLabel } : {})}
      onOpenInTool={open}
    />
  );
}
