import type { ReactElement } from "react";
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider";
import { useActiveWorkspace } from "@/state/app-state-provider";
import { WorkspaceSessions } from "./workspace-sessions-view";

export default function WorkspaceSessionsPage(): ReactElement {
  const workspace = useActiveWorkspace();
  if (!workspace) return <p className="p-6">Select a workspace.</p>;
  return (
    <DiffWorkerProvider>
      <WorkspaceSessions key={workspace.workspaceId} workspace={workspace} />
    </DiffWorkerProvider>
  );
}
