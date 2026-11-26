// The Runtime and model field of a dialog that starts a session: one model picker trigger that sums
// up the runtime, the model, the effort, and a speed above Standard. The New session dialog of
// workspace-session-model-fields.tsx lets the visitor change it. The session start dialog of
// session-start-modal.tsx locks it when it reuses a session: a model with speed levels keeps only
// its speed open, and another model shows the trigger read-only. The classes come from
// StartDialog.css.
import type { ReactElement } from "react";
import type { Session } from "../../sample/sessions";
import { ModelTrigger } from "../models/ModelTrigger";

export function ModelFields({
  session,
  readOnly = false,
}: {
  session: Session;
  readOnly?: boolean;
}): ReactElement {
  return (
    <div className="st-field">
      <b>Runtime and model</b>
      <ModelTrigger
        variant="form"
        disabled={readOnly && session.speed === undefined}
        value={session}
      />
    </div>
  );
}
