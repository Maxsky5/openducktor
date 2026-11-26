// The list of the Processes view in processes-panel.tsx: one toolbar with the empty filter, the
// live dot, and the counts, then each checkout under its header with its commands. The flyout of
// the rail adds Detach and Close to the toolbar. Sources: process-group-section.tsx and
// process-command-row.tsx. Each checkout and each command is open, as the list opens the checkouts
// of the active workspace. A command line can show the stop state: its spinner and Stopping…
// take the place of its ports. A narrow line shows its ports as one button with their count.
import { ChevronRight, FolderGit2, GitBranch, Loader2, Search, Square } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import { type ProcessCommand, type ProcessGroup, PROCESSES_LABELS, processSummary } from "./model";
import { PortsButton } from "./PortsButton";
import "./ProcessesPanel.css";

type ProcessesPanelProps = {
  groups: readonly ProcessGroup[];
  /** The buttons of the surface at the end of the toolbar, such as Detach and Close. */
  actions?: ReactNode;
};

function CommandLine({ command }: { command: ProcessCommand }): ReactElement {
  return (
    <li className="pp-command" data-process-command={command.id}>
      <div className="pp-line" data-process-line="">
        <span className="pp-label">
          <ChevronRight className="pp-chevron" />
          <span className="pp-text">
            {command.directory && (
              <>
                <span className="pp-dir">{command.directory}</span>
                <span className="pp-prompt">$</span>
              </>
            )}
            <span className="pp-cmd">{command.command}</span>
          </span>
        </span>
        <span className="pp-stopping">
          <Loader2 />
          {PROCESSES_LABELS.stopping}
        </span>
        {command.ports.length > 0 && (
          <PortsButton count={command.ports.length} compact className="pp-ports-compact" />
        )}
        {command.ports.length > 0 && (
          <span className="pp-ports">
            {command.ports.map((port) => (
              <span key={port}>:{port}</span>
            ))}
          </span>
        )}
        <span className="pp-stop" data-stop="">
          <Square />
        </span>
      </div>
    </li>
  );
}

function GroupSection({ group }: { group: ProcessGroup }): ReactElement {
  const Icon = group.kind === "repository" ? FolderGit2 : GitBranch;
  return (
    <div className="pp-group" data-process-group={group.id}>
      <div className="pp-group-head">
        <ChevronRight className="pp-chevron" />
        <Icon className="pp-group-icon" />
        <span className="pp-group-title">{group.title}</span>
        {group.subtitle && <span className="pp-group-ids">{group.subtitle}</span>}
        <span className="pp-focused" hidden={!group.focused} data-focus-badge="">
          {PROCESSES_LABELS.focused}
        </span>
      </div>
      <ul className="pp-commands">
        {group.commands.map((command) => (
          <CommandLine command={command} key={command.id} />
        ))}
      </ul>
    </div>
  );
}

export function ProcessesPanel({ groups, actions }: ProcessesPanelProps): ReactElement {
  return (
    <div className="pp">
      <div className="pp-toolbar" data-actions={flag(actions !== undefined)}>
        <Search className="pp-search" />
        <span className="pp-filter">{PROCESSES_LABELS.filter}</span>
        <span className="pp-status">
          <i className="run-dot" />
          <span data-processes-summary="">{processSummary(groups)}</span>
        </span>
        {actions}
      </div>
      <div className="pp-list">
        {groups.map((group) => (
          <GroupSection group={group} key={group.id} />
        ))}
      </div>
    </div>
  );
}
