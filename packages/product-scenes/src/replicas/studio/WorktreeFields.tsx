// The New worktree fields of workspace-session-worktree-fields.tsx and
// workspace-session-worktree-inputs.tsx, in the New branch mode that a new dialog starts in: the
// mode tabs, the hint of the mode, Worktree name with its directory, the closed Advanced section,
// and the new branch. The directory and the branch show when the name is valid. A scene types the
// name, and it shows and fills `data-directory` and `data-new-branch`. The fields and the labels
// use the classes of StartDialog.css.
import { ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Segment } from "../ui/Segment";
import { Segmented } from "../ui/Segmented";
import "./WorktreeFields.css";

/** A worktree name, and the directory and the new branch that the host makes from it. */
export type WorktreeName = { name: string; directory: string | null; branch: string | null };

type WorktreeFieldsProps = {
  worktree: WorktreeName;
  /** Another work location is selected. */
  hidden: boolean;
};

/**
 * Worktree name with its hint and the directory that the host makes from it. The directory shows
 * when the name is valid. The Fork session dialog shows the field too.
 */
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

export function WorktreeFields({ worktree, hidden }: WorktreeFieldsProps): ReactElement {
  return (
    <div className="wt" hidden={hidden} data-worktree-fields="">
      <div className="wt-mode">
        <Segmented size="md" className="wt-tabs">
          <Segment>Existing branch</Segment>
          <Segment active>New branch</Segment>
        </Segmented>
        <p className="wt-hint">Creates a new branch from the target branch.</p>
      </div>
      <WorktreeNameField name={worktree.name} directory={worktree.directory} />
      <div>
        <Button variant="ghost" size="sm" className="wt-advanced">
          <ChevronRight />
          Advanced
        </Button>
        <p
          className="wt-hint wt-path wt-branch"
          hidden={worktree.branch === null}
          data-new-branch=""
        >
          New branch: <span className="mono">{worktree.branch}</span>
        </p>
      </div>
    </div>
  );
}
