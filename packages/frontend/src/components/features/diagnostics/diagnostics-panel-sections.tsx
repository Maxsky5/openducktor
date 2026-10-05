import { FolderGit2, FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import {
  DiagnosticsCallout,
  DiagnosticsCard,
  DiagnosticsCheckRow,
  DiagnosticsGroup,
} from "./diagnostics-card";
import { DiagnosticsOverview } from "./diagnostics-overview";
import type {
  DiagnosticsHostModel,
  DiagnosticsPanelModel,
  DiagnosticsWorkspaceModel,
} from "./diagnostics-panel-model";
import { DiagnosticsRuntimeRow } from "./diagnostics-runtime-row";

export function DiagnosticsPanelSections({
  model,
}: {
  model: DiagnosticsPanelModel;
}): ReactElement {
  return (
    <div className="space-y-6">
      <DiagnosticsOverview overview={model.overview} />
      <HostGroup host={model.host} />
      <WorkspaceGroup workspace={model.workspace} />
    </div>
  );
}

function HostGroup({ host }: { host: DiagnosticsHostModel }): ReactElement {
  return (
    <DiagnosticsGroup title="Host" description="Shared by all workspaces">
      <DiagnosticsCard title="Agent runtimes">
        {host.runtimes.notice ? (
          <div className="px-4 py-3">
            <DiagnosticsCallout tone="warning" title="Runtime states can be out of date">
              <p>{host.runtimes.notice}</p>
            </DiagnosticsCallout>
          </div>
        ) : null}
        <ul className="divide-y divide-border">
          {host.runtimes.entries.map((entry) => (
            <DiagnosticsRuntimeRow key={entry.kind} entry={entry} />
          ))}
        </ul>
      </DiagnosticsCard>
      <DiagnosticsCard title="Tools and services">
        {host.tools.map((check) => (
          <DiagnosticsCheckRow key={check.key} check={check} />
        ))}
      </DiagnosticsCard>
    </DiagnosticsGroup>
  );
}

function WorkspaceGroup({ workspace }: { workspace: DiagnosticsWorkspaceModel }): ReactElement {
  if (workspace.kind === "none") {
    return (
      <DiagnosticsGroup title="Workspace" description="No workspace selected">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 text-center">
          <FolderOpen className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{workspace.emptyMessage}</p>
        </div>
      </DiagnosticsGroup>
    );
  }
  return (
    <DiagnosticsGroup title="Workspace" description="Selected workspace only">
      <DiagnosticsCard
        title={
          <div className="flex min-w-0 items-center gap-2.5">
            <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{workspace.name}</p>
              <p
                className="truncate font-mono text-[11px] font-normal text-muted-foreground"
                title={workspace.path}
              >
                {workspace.path}
              </p>
            </div>
          </div>
        }
      >
        {workspace.checks.map((check) => (
          <DiagnosticsCheckRow key={check.key} check={check} />
        ))}
      </DiagnosticsCard>
    </DiagnosticsGroup>
  );
}
