// The per-role agent defaults of a repository, from settings-repository-agents-section.tsx. The
// markup holds the last frame: the model picker of the Spec role is open on the Claude runtime,
// and Lyra 3 is the selected model.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { RoleDefault } from "../../replicas/settings/RoleDefault";
import { SettingsPane } from "../../replicas/settings/SettingsPane";
import { Pointer } from "../../replicas/shell/Pointer";
import { modelKey, ROLE_DEFAULTS, SPEC_AFTER } from "../../sample/models";

export function RuntimesView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="runtimes"
      alt="The per-role agent defaults of a repository. You open the model picker of the Spec role, look at the OpenCode and Codex models, and choose Lyra 3 in the Claude runtime. The Planner and the Builder use Codex, and QA uses OpenCode."
    >
      <SettingsPane data-pane>
        <div className="set-content">
          <div className="set-heading">
            <div className="set-title">Agent defaults by role</div>
            <p>Defaults are applied when starting sessions in this repository.</p>
          </div>
          <div className="role-list">
            {ROLE_DEFAULTS.map((item) => (
              <RoleDefault
                {...item}
                key={item.role}
                picker={
                  item.role === "spec"
                    ? { view: SPEC_AFTER.runtime, selected: modelKey(SPEC_AFTER) }
                    : undefined
                }
              />
            ))}
          </div>
        </div>
        <Pointer />
      </SettingsPane>
    </SceneFrame>
  );
}
