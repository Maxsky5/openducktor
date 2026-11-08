// The Diagnostics sheet with the fieldnotes workspace selected. The markup holds the last frame:
// the host runs its three runtimes, and every check passed.
import { FolderGit2 } from "lucide-react";
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { DiagCard } from "../../replicas/diagnostics/DiagCard";
import { DiagGroup } from "../../replicas/diagnostics/DiagGroup";
import { DiagnosticsSheet } from "../../replicas/diagnostics/DiagnosticsSheet";
import { DiagRow } from "../../replicas/diagnostics/DiagRow";
import { REPOSITORY_PATH, WORKSPACE } from "../../sample/workspace";
import { HEALTHY, RUNTIMES, TOOLS, WORKSPACE_CHECKS } from "./sample";
import "./view.css";

export function LocalView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="local"
      alt="The Diagnostics panel. The OpenDucktor host starts OpenCode, Codex, and Claude Code, one shared runtime of each kind for all workspaces. The checks find PATH and Git, and the OpenDucktor MCP bridge is ready. The fieldnotes workspace has its worktree folder, and its SQLite task store is ready. Everything is working."
    >
      <DiagnosticsSheet overview={HEALTHY}>
        <DiagGroup title="Host" description="Shared by all workspaces">
          <DiagCard title={<span>Agent runtimes</span>}>
            {RUNTIMES.map((check) => (
              <DiagRow {...check} key={check.id} />
            ))}
          </DiagCard>
          <DiagCard title={<span>Tools and services</span>}>
            {TOOLS.map((check) => (
              <DiagRow {...check} key={check.id} />
            ))}
          </DiagCard>
        </DiagGroup>
        <DiagGroup title="Workspace" description="Selected workspace only">
          <DiagCard
            title={
              <>
                <FolderGit2 />
                <span>
                  {WORKSPACE}
                  <small>{REPOSITORY_PATH}</small>
                </span>
              </>
            }
          >
            {WORKSPACE_CHECKS.map((check) => (
              <DiagRow {...check} key={check.id} />
            ))}
          </DiagCard>
        </DiagGroup>
      </DiagnosticsSheet>
    </SceneFrame>
  );
}
