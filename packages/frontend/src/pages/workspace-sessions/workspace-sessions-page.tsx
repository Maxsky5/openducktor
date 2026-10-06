import { memo, type ReactElement } from "react";
import { useActiveWorkspace } from "@/state/app-state-provider";
import { WorkspaceSessions } from "./workspace-sessions-view";

const WorkspaceSessionsPage = memo(function WorkspaceSessionsPage(): ReactElement {
  const workspace = useActiveWorkspace();
  if (!workspace) return <p className="p-6">Select a workspace.</p>;
  return <WorkspaceSessions workspace={workspace} />;
});

export default WorkspaceSessionsPage;
