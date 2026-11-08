// One role card of settings-repository-agents-section.tsx: the role label, Clear, and the
// Runtime and model, Agent profile, and Effort fields. Only OpenCode supports agent profiles.
// The trigger holds the three runtime logos and `data-runtime` shows one, so a scene can
// change the runtime without new markup.
import type { ReactElement } from "react";
import { modelName, type RoleDefault as RoleDefaultData, RUNTIMES } from "../../sample/models";
import { flag } from "../flag";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { ModelPicker, type ModelPickerProps } from "./ModelPicker";
import "./RoleDefault.css";

type RoleDefaultProps = RoleDefaultData & {
  /** The open model picker under the Runtime and model field. */
  picker?: ModelPickerProps | undefined;
};

export function RoleDefault({
  role,
  label,
  runtime,
  model,
  profile,
  variant,
  picker,
}: RoleDefaultProps): ReactElement {
  return (
    <div className="set-card role-card" data-role={role}>
      <div className="role-head">
        <p>{label}</p>
        <Button variant="ghost" size="sm">
          Clear
        </Button>
      </div>
      <div className="role-fields">
        <div className="set-field">
          <span className="set-label">Runtime and model</span>
          <Combobox data-model-trigger>
            <span className="rt-swap" data-runtime={runtime} data-runtime-logos="">
              {RUNTIMES.map((kind) => (
                <RuntimeIcon kind={kind} key={kind} />
              ))}
            </span>
            <span data-model-name="">{modelName({ runtime, model })}</span>
          </Combobox>
          {picker && <ModelPicker {...picker} />}
        </div>
        <div className="set-field">
          <span className="set-label">Agent profile</span>
          <Combobox data-disabled={flag(!profile)}>
            {profile ? (
              <>
                <i className="profile-dot" />
                <span>{profile}</span>
              </>
            ) : (
              <span className="set-placeholder">Not supported by runtime</span>
            )}
          </Combobox>
        </div>
        <div className="set-field">
          <span className="set-label">Effort</span>
          <Combobox>
            <span>{variant}</span>
          </Combobox>
        </div>
      </div>
    </div>
  );
}
