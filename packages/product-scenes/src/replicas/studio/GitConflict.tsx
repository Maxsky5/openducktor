// The Git conflict of a rebase in the Diffs tab: the strip of git-conflict-strip.tsx under the
// header, and the dialog of git-conflict-dialog.tsx, which opens when the rebase stops. Both offer
// Abort rebase and Resolve conflicts of git-conflict-actions.tsx. Resolve conflicts has the hook
// `data-resolve`.
import { AlertTriangle, RotateCcw, Sparkles, X } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import "./StartDialog.css";
import "./GitConflict.css";

/** The words of conflict-copy.ts and git-conflict-actions-model.ts for a rebase. */
export const CONFLICT_TEXT = {
  title: "Rebase conflict detected",
  inProgress: "Rebase in progress",
  operation: "rebase",
  abort: "Abort rebase",
  resolve: "Resolve conflicts",
} as const;

type GitConflictProps = { target: string; files: readonly string[]; output: string };

const conflictCount = (files: readonly string[]): string =>
  `${files.length} conflicted file${files.length === 1 ? "" : "s"}`;

/** The strip uses small buttons, and the dialog uses default buttons. */
function Actions({ size }: { size: "sm" | "default" }): ReactElement {
  return (
    <span className="gc-actions">
      <Button variant="outline" size={size}>
        <RotateCcw className="i16" />
        {CONFLICT_TEXT.abort}
      </Button>
      <Button size={size} data-resolve="">
        <Sparkles className="i16" />
        {CONFLICT_TEXT.resolve}
      </Button>
    </span>
  );
}

/** The strip under the header of the Diffs tab while the rebase waits on its conflicts. */
export function ConflictStrip({ target, files }: Omit<GitConflictProps, "output">): ReactElement {
  return (
    <div className="gc-strip" data-conflict-strip="">
      <div className="gc-strip-top">
        <span className="gc-strip-icon">
          <AlertTriangle className="i16" />
        </span>
        <div className="gc-strip-text">
          <p>
            <b>{CONFLICT_TEXT.inProgress}</b>
            <span className="gc-count">{conflictCount(files)}</span>
          </p>
          <p>
            The {CONFLICT_TEXT.operation} onto <b>{target}</b> is still paused on conflicts.
          </p>
        </div>
      </div>
      <div className="gc-strip-foot">
        <Button variant="outline" size="sm">
          View details
        </Button>
        <Actions size="sm" />
      </div>
    </div>
  );
}

/** The dialog that opens when the rebase stops on conflicts. */
export function ConflictDialog({ target, files, output }: GitConflictProps): ReactElement {
  return (
    <div className="st-overlay">
      <div className="st-dialog gc-dialog" data-dialog-box="">
        <span className="st-dialog-close">
          <X />
        </span>
        <div className="st-dialog-head">
          <b>{CONFLICT_TEXT.title}</b>
          <p>
            The {CONFLICT_TEXT.operation} onto <code>{target}</code> stopped on conflicts. Abort the
            git operation or send the conflict to Builder for resolution.
          </p>
        </div>
        <div className="gc-dialog-body">
          <b>Conflicted files</b>
          <ul>
            {files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
          <b>Git output</b>
          <pre>{output}</pre>
        </div>
        <div className="gc-dialog-foot">
          <Button variant="outline">Close</Button>
          <Actions size="default" />
        </div>
      </div>
    </div>
  );
}
