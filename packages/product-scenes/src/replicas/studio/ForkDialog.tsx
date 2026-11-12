// The Fork session dialog of workspace-session-fork-dialog.tsx, with the words of FORK_CHAT_TEXT in
// workspace-session-fork-form.ts: Work location with Same folder and New worktree, the source
// folder, and the fields of New worktree. It uses the dialog shell of SessionCreateDialog.css, as
// the app gives both dialogs the same DialogContent. After Fork session, the dialog shows the
// startup progress in the `progress` slot: the box gets `data-progress`, it narrows, and the
// description, the form, and the footer hide.
import { Folder, GitBranch, GitFork, LoaderCircle, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { WorkLocationField, type WorkLocationOption } from "./WorkLocationField";
import { WorktreeNameField } from "./WorktreeFields";
import "./StartDialog.css";
import "./SessionCreateDialog.css";
import "./ForkDialog.css";

/** Where the fork works, by the values of workspace-session-fork-form.ts. */
export type ForkLocation = "same_folder" | "new_worktree";

/** The words of the dialog: FORK_CHAT_TEXT of workspace-session-fork-form.ts. */
export const FORK_TEXT = {
  title: "Fork session",
  description: "Copy the conversation through this reply, then choose where the new session works.",
  sameFolder: "Same folder",
  sameFolderDescription: "Work with the files already here.",
  newWorktree: "New worktree",
  newWorktreeDescription: "Start from the last commit in the source folder.",
  sourceFolder: "Source folder",
  uncommittedChanges: "Uncommitted changes in the source folder do not go to the new worktree.",
  confirm: "Fork session",
  confirming: "Forking session…",
} as const;

const LOCATIONS: readonly WorkLocationOption<ForkLocation>[] = [
  {
    value: "same_folder",
    label: FORK_TEXT.sameFolder,
    description: FORK_TEXT.sameFolderDescription,
    Icon: Folder,
  },
  {
    value: "new_worktree",
    label: FORK_TEXT.newWorktree,
    description: FORK_TEXT.newWorktreeDescription,
    Icon: GitBranch,
  },
];

/** The folder of the source session: its name, its branch, and its directory. */
export type ForkSource = { name: string; branch: string; directory: string };

/** The worktree that the form suggests: its name, its directory name, and its default branch. */
export type ForkWorktree = { name: string; directory: string; branch: string };

type ForkDialogProps = {
  location: ForkLocation;
  source: ForkSource;
  worktree: ForkWorktree;
  /** The startup progress, which shows after Fork session. */
  progress: ReactNode;
};

/** The source folder card: the folder, its branch badge, and its directory. */
function SourceFolder({ source }: { source: ForkSource }): ReactElement {
  return (
    <div className="fd-source">
      <p className="fd-source-label">{FORK_TEXT.sourceFolder}</p>
      <div className="fd-source-row">
        <p className="fd-source-name">
          <Folder className="i16" />
          <span>{source.name}</span>
        </p>
        <span className="fd-badge">
          <GitBranch />
          <span>{source.branch}</span>
        </span>
      </div>
      <p className="fd-source-path mono">{source.directory}</p>
    </div>
  );
}

/**
 * The fields of New worktree: the worktree name with its directory, the optional branch name that
 * shows the default branch, the new branch, and the note on uncommitted changes.
 */
function WorktreeFields({
  worktree,
  hidden,
}: {
  worktree: ForkWorktree;
  hidden: boolean;
}): ReactElement {
  return (
    <div className="fd-worktree" hidden={hidden} data-worktree-fields="">
      <WorktreeNameField name={worktree.name} directory={worktree.directory} />
      <div>
        <div className="st-field fd-branch">
          <b>
            Branch name <span className="sc-optional">optional</span>
          </b>
          <Input placeholder={worktree.branch} />
        </div>
        <p className="wt-hint wt-path wt-branch">
          New branch: <span className="mono">{worktree.branch}</span>
        </p>
      </div>
      <p className="fd-note">{FORK_TEXT.uncommittedChanges}</p>
    </div>
  );
}

export function ForkDialog({
  location,
  source,
  worktree,
  progress,
}: ForkDialogProps): ReactElement {
  return (
    <div className="st-overlay sc-overlay" data-fork-dialog="">
      <div className="sc-dialog fd-dialog" data-dialog-box="">
        <div className="sc-head">
          <b>{FORK_TEXT.title}</b>
          <p>{FORK_TEXT.description}</p>
        </div>
        <div className="sc-body fd-body" data-dialog-body="">
          <WorkLocationField value={location} options={LOCATIONS} />
          <SourceFolder source={source} />
          <WorktreeFields worktree={worktree} hidden={location !== "new_worktree"} />
        </div>
        <div className="sc-progress">{progress}</div>
        <div className="sc-foot">
          <Button variant="outline">Cancel</Button>
          <Button data-confirm="">
            <GitFork className="sc-create-icon" />
            <LoaderCircle className="sc-starting-icon spin" />
            <span className="sc-create-label">{FORK_TEXT.confirm}</span>
            <span className="sc-starting-label">{FORK_TEXT.confirming}</span>
          </Button>
        </div>
        <span className="sc-close">
          <X />
        </span>
      </div>
    </div>
  );
}
