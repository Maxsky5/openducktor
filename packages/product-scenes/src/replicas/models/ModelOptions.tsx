// The options bar at the bottom of the model picker, from model-picker-options-pane.tsx: the effort
// slider of the selected model and, for OpenCode, the agent profile next to it. The bar shows the
// options of the selected model, not of the runtime that the rail shows.
import type { ReactElement } from "react";
import { type ModelChoice, modelEfforts, modelKey } from "../../sample/models";
import { flag } from "../flag";
import { Combobox } from "../ui/Combobox";
import { EffortTrack } from "./EffortTrack";
import "./ModelOptions.css";

export function ModelOptions({
  value,
  hidden = false,
}: {
  value: ModelChoice;
  hidden?: boolean;
}): ReactElement {
  return (
    <div className="mo" hidden={hidden} data-options={modelKey(value)}>
      <div className="mo-grid" data-columns={flag(value.profile !== undefined)}>
        <div className="mo-effort">
          <span className="mo-label">Effort</span>
          <EffortTrack stops={modelEfforts(value)} value={value.effort} />
        </div>
        {value.profile !== undefined && (
          <div className="mo-profile">
            <span className="mo-label">Profile</span>
            <Combobox className="mo-combobox">
              <span>{value.profile}</span>
            </Combobox>
          </div>
        )}
      </div>
    </div>
  );
}
