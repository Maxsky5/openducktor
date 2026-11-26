// The dialogs of the workflow editor in the layout of WORKFLOW_DIALOG of workflow-dialog.ts: a
// header and a footer with dividers across the full width, a body between them, and two widths.
// AddStateDialog is NewElementDialog of panels/new-element-button.tsx, which Add a state of the
// canvas toolbar opens. PublishDialog is publish-dialog.tsx in TaskMovesDialog of
// task-moves-dialog.tsx, with the tasks on the older version that can move. `modal` of
// replicas/studio/modal.ts opens and closes them. A scene types the name with `data-name-input`,
// enables Create with `data-disabled`, and sets `data-busy` on Publish while it runs.
import { Check, Globe, Loader2, Plus, Upload, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { ADD_STATE_TEXT, availableIn, PUBLISH_TEXT, publishDescription } from "./text";
import "../studio/StartDialog.css";
import "./WorkflowDialogs.css";

type DialogProps = {
  size: "sm" | "lg";
  title: string;
  description?: string;
  footer: ReactNode;
  children: ReactNode;
};

/** A dialog box of WORKFLOW_DIALOG with its close button. */
function WorkflowDialog({ size, title, description, footer, children }: DialogProps): ReactElement {
  return (
    <div className="wfd-box" data-dialog-box="" data-size={size}>
      <div className="wfd-head">
        <b>{title}</b>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      <div className="wfd-body">{children}</div>
      <div className="wfd-foot">{footer}</div>
      <span className="st-dialog-close">
        <X />
      </span>
    </div>
  );
}

export function AddStateDialog(): ReactElement {
  const text = ADD_STATE_TEXT;
  return (
    <div className="st-overlay wfd-overlay" hidden data-add-state-dialog="">
      <WorkflowDialog
        size="sm"
        title={text.title}
        footer={
          <>
            <Button variant="outline">{text.cancel}</Button>
            <Button data-create data-disabled>
              <Plus />
              {text.create}
            </Button>
          </>
        }
      >
        <div className="wfd-name">
          <span>{text.name}</span>
          <Input placeholder={text.placeholder} data-name-input data-focused />
        </div>
      </WorkflowDialog>
    </div>
  );
}

/** A task on an older version that the publication can move, as TaskMovesList lists it. */
export type MovableTask = {
  readonly title: string;
  readonly id: string;
  readonly state: string;
  readonly version: number;
};

type PublishDialogProps = {
  /** The version that the draft becomes. */
  version: number;
  /** The repository of the tasks and its tasks on older versions. */
  repository: string;
  tasks: readonly MovableTask[];
};

export function PublishDialog({ version, repository, tasks }: PublishDialogProps): ReactElement {
  const text = PUBLISH_TEXT;
  return (
    <div className="st-overlay wfd-overlay" hidden data-publish-dialog="">
      <WorkflowDialog
        size="lg"
        title={text.title}
        description={publishDescription(version)}
        footer={
          <>
            <Button variant="outline">{text.cancel}</Button>
            <Button data-confirm>
              <Upload className="ui-idle-icon" />
              <Loader2 className="ui-busy-icon spin" />
              {text.confirm}
            </Button>
          </>
        }
      >
        <p className="wfd-note">
          <Globe />
          <span>{availableIn(text.availability)}</span>
        </p>
        <p className="wfd-moves-title">{text.moves}</p>
        <div className="wfd-group">
          <p className="wfd-repository">{repository}</p>
          <ul>
            {tasks.map((task) => (
              <li key={task.id}>
                <span className="wfd-checkbox">
                  <Check />
                </span>
                <span className="wfd-task">
                  <span>{task.title}</span>
                  <small>{`${task.id} · ${task.state} · version ${task.version}`}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </WorkflowDialog>
    </div>
  );
}
