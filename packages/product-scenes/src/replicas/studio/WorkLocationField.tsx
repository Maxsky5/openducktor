// The Work location field of workspace-session-work-location-field.tsx: a radio group of outline
// cards, with the icon, the label, the check of the selected card, and the description. The New
// session dialog lists its three locations, and the Fork session dialog gives its two. A scene
// moves `data-selected`.
import { Check, Folder, FolderGit2, GitBranch, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import "./WorkLocationField.css";

/** The locations of a new session, by the values of workspace-session-create-dialog.tsx. */
export type WorkLocation = "local_repo_root" | "local_worktree" | "existing_worktree";

/** A card of the field: its value, label, description, and icon. */
export type WorkLocationOption<Value extends string> = {
  value: Value;
  label: string;
  description: string;
  Icon: LucideIcon;
};

const OPTIONS: readonly WorkLocationOption<WorkLocation>[] = [
  {
    value: "local_repo_root",
    label: "Current checkout",
    description: "Work with the files already here.",
    Icon: Folder,
  },
  {
    value: "local_worktree",
    label: "New worktree",
    description: "Use an isolated directory and branch.",
    Icon: GitBranch,
  },
  {
    value: "existing_worktree",
    label: "Existing worktree",
    description: "Use a worktree that already exists.",
    Icon: FolderGit2,
  },
];

type WorkLocationFieldProps<Value extends string> = {
  value: Value;
  /** The cards. The default is the three locations of a new session. */
  options?: readonly WorkLocationOption<Value>[];
};

export function WorkLocationField<Value extends string = WorkLocation>({
  value,
  options,
}: WorkLocationFieldProps<Value>): ReactElement {
  const cards: readonly WorkLocationOption<string>[] = options ?? OPTIONS;
  return (
    <div className="wl">
      <b className="wl-legend">Work location</b>
      <div className="wl-options" data-columns={cards.length}>
        {cards.map(({ value: option, label, description, Icon }) => (
          <span
            className="wl-option"
            data-location={option}
            data-selected={flag(option === value)}
            key={option}
          >
            <Icon />
            <span className="wl-label">{label}</span>
            <Check className="wl-check" />
            <span className="wl-description">{description}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
