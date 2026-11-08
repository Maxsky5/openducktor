// The New session dialog of workspace-session-create-dialog.tsx and
// workspace-session-model-fields.tsx: Name, the runtime and model with the effort and the speed,
// Custom role, Work location, Target branch, and the worktree fields of New worktree. The header
// and the footer stay while the body scrolls, as the dialog does in a short window. After Create
// session, the dialog shows the startup progress in the `progress` slot: the box gets
// `data-progress`, it narrows, and the description, the form, and the footer hide.
import { LoaderCircle, MessageSquarePlus, Settings, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { Session } from "../../sample/sessions";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Input } from "../ui/Input";
import { type WorkLocation, WorkLocationField } from "./WorkLocationField";
import { type WorktreeName, WorktreeFields } from "./WorktreeFields";
import { ModelFields } from "./ModelFields";
import "./StartDialog.css";
import "./SessionCreateDialog.css";

type SessionCreateDialogProps = {
  /** The Default Model of the repository. A model with more than one speed shows Speed. */
  session: Session;
  /** The selected target branch. */
  target: string;
  location: WorkLocation;
  /** The typed session name. */
  name: string;
  worktree: WorktreeName;
  /** The startup progress, which shows after Create session. */
  progress: ReactNode;
};

export function SessionCreateDialog({
  session,
  target,
  location,
  name,
  worktree,
  progress,
}: SessionCreateDialogProps): ReactElement {
  return (
    <div className="st-overlay sc-overlay" data-session-dialog="">
      <div className="sc-dialog" data-dialog-box="">
        <div className="sc-head">
          <b>New session</b>
          <p>Choose where the agent works and how it starts.</p>
        </div>
        <div className="sc-body" data-dialog-body="">
          <div className="st-field">
            <b>
              Name <span className="sc-optional">optional</span>
            </b>
            <Input placeholder="What are you working on?" value={name} data-field="name" />
          </div>
          <ModelFields session={session} />
          <div className="st-field">
            <b>
              Custom role <span className="sc-optional">optional</span>
            </b>
            <div className="sc-role">
              <Combobox>
                <span>No role</span>
              </Combobox>
              <Button variant="outline">
                <Settings />
                Manage roles
              </Button>
            </div>
          </div>
          <WorkLocationField value={location} />
          <div className="st-field">
            <b>Target branch</b>
            <Combobox branch data-target="">
              <span>{target}</span>
            </Combobox>
            <p className="sc-hint">Compare this session's changes with this branch.</p>
          </div>
          <WorktreeFields worktree={worktree} hidden={location !== "local_worktree"} />
        </div>
        <div className="sc-progress">{progress}</div>
        <div className="sc-foot">
          <Button variant="outline">Cancel</Button>
          <Button data-create="">
            <MessageSquarePlus className="sc-create-icon" />
            <LoaderCircle className="sc-starting-icon spin" />
            <span className="sc-create-label">Create session</span>
            <span className="sc-starting-label">Creating session…</span>
          </Button>
        </div>
        <span className="sc-close">
          <X />
        </span>
      </div>
    </div>
  );
}
