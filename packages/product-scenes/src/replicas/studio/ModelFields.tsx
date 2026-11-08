// The model fields of a dialog that starts a session: Runtime and model, Effort, and Speed for a
// model that offers more than Standard. The session start dialog of StartDialog.tsx shows them
// read-only when it reuses a session, and the New session dialog lets the visitor change them.
// The classes come from StartDialog.css.
import { ZapOff } from "lucide-react";
import type { ReactElement } from "react";
import { modelName } from "../../sample/models";
import type { Session } from "../../sample/sessions";
import { flag } from "../flag";
import { Combobox } from "../ui/Combobox";
import { RuntimeIcon } from "../ui/RuntimeIcon";

export function ModelFields({
  session,
  readOnly = false,
}: {
  session: Session;
  readOnly?: boolean;
}): ReactElement {
  return (
    <div className="st-field-row">
      <div className="st-field">
        <b>Runtime and model</b>
        <Combobox data-disabled={flag(readOnly)}>
          <RuntimeIcon kind={session.runtime} />
          <span>{modelName(session)}</span>
        </Combobox>
      </div>
      <div className="st-field-pair">
        <div className="st-field">
          <b>Effort</b>
          <Combobox data-disabled={flag(readOnly)}>
            <span>{session.effort}</span>
          </Combobox>
        </div>
        {session.speed && (
          <div className="st-field st-speed-field">
            <b>Speed</b>
            <Combobox data-disabled={flag(readOnly)}>
              <ZapOff className="i14" />
              <span>Standard</span>
            </Combobox>
          </div>
        )}
      </div>
    </div>
  );
}
