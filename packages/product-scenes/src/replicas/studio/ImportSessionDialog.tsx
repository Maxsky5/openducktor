// The Import session dialog of workspace-session-import-dialog.tsx, with the search of
// workspace-session-import-search.tsx and the list of workspace-session-import-results.tsx: the
// runtime field with its option list, the search field, the loading state, one row for each
// external session, and the session count. It uses the dialog shell of SessionCreateDialog.css, as
// the app gives the dialogs the same DialogContent. The markup holds the dialog with a runtime and
// the full list. A scene hides the parts that show later.
import { Folder, Import, LoaderCircle, Search, X } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import {
  type ExternalSession,
  IMPORT_TEXT,
  type ImportRuntime,
  sessionCount,
} from "./import-session-text";
import "../ui/Input.css";
import "./StartDialog.css";
import "./SessionCreateDialog.css";
import "./ImportSessionDialog.css";

type ImportSessionDialogProps = {
  runtimes: readonly ImportRuntime[];
  /** The runtime of the markup. */
  runtime: ImportRuntime;
  sessions: readonly ExternalSession[];
};

/** A row: the title, the directory, and the session ID, then the time and Import. */
function SessionRow({ session }: { session: ExternalSession }): ReactElement {
  return (
    <li className="is-row" data-session-row={session.id}>
      <div className="is-row-text">
        <p className="is-row-title">{session.title}</p>
        <p className="is-row-meta">
          <Folder className="is-row-folder" />
          <span>{session.directory}</span>
        </p>
        <p className="is-row-meta is-row-id">
          <span>{IMPORT_TEXT.sessionId}</span>
          <span className="mono">{session.id}</span>
        </p>
      </div>
      <div className="is-row-end">
        <span className="is-row-time">{session.updated}</span>
        <Button size="sm" variant="outline" data-import={session.id}>
          <Import className="is-import-icon" />
          <LoaderCircle className="is-importing-icon spin" />
          <span className="is-import-label">{IMPORT_TEXT.import}</span>
          <span className="is-importing-label">{IMPORT_TEXT.importing}</span>
        </Button>
      </div>
    </li>
  );
}

/**
 * The option list of the runtime Combobox: a PopoverContent with p-0 and the width of the trigger,
 * and a CommandGroup with p-1. The popover is in a portal in the dialog content, with fixed
 * position, so the overflow of the dialog does not clip it. It is a child of the overlay here, and
 * the scene puts it under the trigger. No runtime has a check mark before the visitor chooses one.
 */
function RuntimeOptions({ runtimes }: { runtimes: readonly ImportRuntime[] }): ReactElement {
  return (
    <div className="is-options" data-runtime-options="" hidden>
      <div className="is-options-group">
        {runtimes.map((option) => (
          <span className="is-option" data-runtime-option={option.kind} key={option.kind}>
            <span className="is-option-icon">
              <RuntimeIcon kind={option.kind} />
            </span>
            <span className="is-option-label">{option.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ImportSessionDialog({
  runtimes,
  runtime,
  sessions,
}: ImportSessionDialogProps): ReactElement {
  return (
    <div className="st-overlay sc-overlay is-overlay" data-import-dialog="">
      <div className="sc-dialog is-dialog" data-dialog-box="" data-chosen="">
        <div className="sc-head is-head">
          <b>{IMPORT_TEXT.title}</b>
          <p>{IMPORT_TEXT.description}</p>
        </div>
        <div className="is-body" data-dialog-body="">
          <div className="is-runtime">
            <b className="st-label">{IMPORT_TEXT.runtime}</b>
            <Combobox data-runtime-trigger="">
              <span className="is-placeholder" data-runtime-placeholder="" hidden>
                {IMPORT_TEXT.runtimePlaceholder}
              </span>
              <span className="is-value" data-runtime-value="">
                <RuntimeIcon kind={runtime.kind} />
                <span>{runtime.label}</span>
              </span>
            </Combobox>
          </div>
          <div className="is-results" data-results="">
            <div className="is-search">
              <b className="st-label">{IMPORT_TEXT.search}</b>
              <span className="ui-input is-search-input" data-search="">
                <Search className="is-search-icon" />
                <span className="typed" data-typed="" />
                <span className="ui-input-placeholder">{IMPORT_TEXT.searchPlaceholder}</span>
                <X className="is-search-clear" />
              </span>
            </div>
            <div className="is-loading" data-loading="" hidden>
              <LoaderCircle className="is-loading-icon spin" />
              <p className="is-loading-title" data-loading-title="">
                {IMPORT_TEXT.finding}
              </p>
              <p>{IMPORT_TEXT.slow}</p>
            </div>
            <ul className="is-list" data-session-list="">
              {sessions.map((session) => (
                <SessionRow session={session} key={session.id} />
              ))}
            </ul>
            <div className="is-count" data-count="">
              {sessionCount(sessions.length)}
            </div>
          </div>
        </div>
        <div className="sc-foot">
          <Button variant="outline" data-cancel>
            Cancel
          </Button>
        </div>
        <span className="sc-close" data-close="">
          <X />
        </span>
      </div>
      <RuntimeOptions runtimes={runtimes} />
    </div>
  );
}
