// The Close task confirmation of task-close-confirm-dialog.tsx in
// packages/frontend/src/components/features/task-details, which a Kanban card, the task details,
// and the session header open: TaskDialogHeader, the content of task-close-confirm-content.tsx
// without a merge check, and the footer, with the text of task-close-copy.ts in
// packages/frontend-core. The dialog shows the loader of its reads, then the merge status of a
// merged task branch, the cleanup switch, and what a close keeps. A scene sets `data-loading`
// while the dialog reads, and `data-closing` while the close runs.
import {
  Check,
  ChevronDown,
  CircleCheckBig,
  Copy,
  FolderGit2,
  GitMerge,
  LoaderCircle,
  X,
} from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import "../studio/StartDialog.css";
import "./CloseTaskDialog.css";

/** The words of the dialog. */
export const CLOSE_TASK_DIALOG_TEXT = {
  title: "Close task",
  description: "Close the task and keep its history.",
  loading: "Loading task details…",
  removeWorktree: "Remove worktree and branch",
  noUncommittedChanges: "No uncommitted changes.",
  worktreeDetails: "Worktree details",
  afterClosing: "After closing",
  closeNotes: [
    "Closing does not merge code or change a pull request.",
    "The task keeps its artifacts, session history, and pull request link. Workflow rules control artifact editing.",
  ],
  cancel: "Cancel",
  confirm: "Close task",
  closing: "Closing…",
} as const;

/** The merge status of describeTaskMergeStatus for a merged task branch. */
export function mergedStatusText(target: string): string {
  return `Branch merged into ${target}.`;
}

type CloseTaskDialogProps = {
  /** The title and the ID of the task. */
  task: { title: string; id: string };
  /** The target branch that holds the task branch, such as origin/main. */
  target: string;
};

/** DialogLoadingContent: the spinner, its label, and two skeleton lines. */
function Loader(): ReactElement {
  return (
    <div className="ctd-loading">
      <div className="ctd-loading-row">
        <span className="ctd-spinner">
          <LoaderCircle className="spin" />
        </span>
        <span>{CLOSE_TASK_DIALOG_TEXT.loading}</span>
      </div>
      <div className="ctd-skeleton">
        <i />
        <i />
      </div>
    </div>
  );
}

/** TaskCloseConfirmContent of a merged task branch whose worktree has no uncommitted changes. */
function CloseContent({ target }: { target: string }): ReactElement {
  const text = CLOSE_TASK_DIALOG_TEXT;
  return (
    <div className="ctd-content">
      <div className="ctd-merge">
        <GitMerge />
        <p>{mergedStatusText(target)}</p>
      </div>
      <div className="ctd-cleanup">
        <div className="ctd-cleanup-row">
          <FolderGit2 />
          <span className="ctd-cleanup-label">{text.removeWorktree}</span>
          <Switch checked />
        </div>
        <div className="ctd-targets">
          <p>{text.noUncommittedChanges}</p>
          <Button variant="ghost" size="sm" className="ctd-details">
            <ChevronDown />
            {text.worktreeDetails}
          </Button>
        </div>
      </div>
      <section className="ctd-after">
        <h3>{text.afterClosing}</h3>
        <ul>
          {text.closeNotes.map((note) => (
            <li key={note}>
              <Check />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function CloseTaskDialog({ task, target }: CloseTaskDialogProps): ReactElement {
  const text = CLOSE_TASK_DIALOG_TEXT;
  return (
    <div className="st-overlay ctd-overlay" hidden data-close-dialog="">
      <div className="ctd-dialog" data-dialog-box="">
        <div className="ctd-head">
          <div className="ctd-heading">
            <span className="ctd-icon">
              <CircleCheckBig />
            </span>
            <div className="ctd-titles">
              <b>{text.title}</b>
              <p>{text.description}</p>
            </div>
          </div>
          <div className="ctd-identity">
            <span className="ctd-task">{task.title}</span>
            <span className="ctd-id">
              <span>{task.id}</span>
              <span className="ctd-copy">
                <Copy />
              </span>
            </span>
          </div>
        </div>
        <div className="ctd-body">
          <Loader />
          <CloseContent target={target} />
        </div>
        <div className="ctd-foot">
          <Button variant="outline">{text.cancel}</Button>
          <Button variant="warning" data-confirm>
            <CircleCheckBig className="ctd-idle" />
            <LoaderCircle className="spin ctd-busy" />
            <span className="ctd-idle">{text.confirm}</span>
            <span className="ctd-busy">{text.closing}</span>
          </Button>
        </div>
        <span className="st-dialog-close">
          <X />
        </span>
      </div>
    </div>
  );
}
