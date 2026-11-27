// The Worktree name field of workspace-session-worktree-inputs.tsx, which the Fork session dialog
// shows for New worktree: the name, its hint, and the directory that the host makes from it. The
// directory shows when the name is valid. A scene types the name, and it shows and fills
// `data-directory`. The field and its label use the classes of StartDialog.css.
import type { ReactElement } from "react";
import { Input } from "../ui/Input";
import "./WorktreeFields.css";

export function WorktreeNameField({
  name,
  directory,
}: {
  name: string;
  directory: string | null;
}): ReactElement {
  return (
    <div className="st-field">
      <b>Worktree name</b>
      <Input placeholder="my-feature" value={name} data-field="worktree" />
      <p className="wt-hint">Spaces and slashes become hyphens in the directory name.</p>
      <p className="wt-hint wt-path" hidden={directory === null} data-directory="">
        Directory: <span className="mono">{directory}</span>
      </p>
    </div>
  );
}
