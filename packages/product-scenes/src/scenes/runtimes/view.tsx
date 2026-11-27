// The Agent defaults by role section of the Agents settings of a repository, from
// repository-model-defaults-fields.tsx, in a Settings dialog narrower than 40rem, where the role
// rows take one column. The markup holds a frame from the end of the story, before the picker
// closes: the model picker of the Spec role is open on Antigravity, Gemini 4 Comet is selected at
// the effort xhigh, and the Spec trigger sums it up. So visitors without motion see the runtime
// rail, a model list, and the effort slider.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { ModelPicker } from "../../replicas/models/ModelPicker";
import { RoleDefault, RoleDefaults } from "../../replicas/settings/RoleDefault";
import { SettingsPane } from "../../replicas/settings/SettingsPane";
import { Pointer } from "../../replicas/shell/Pointer";
import { Tooltip } from "../../replicas/ui/Tooltip";
import { ROLE_DEFAULTS, SPEC_AFTER, SPEC_BEFORE } from "./sample";
import "./view.css";

export function RuntimesView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="runtimes"
      alt="The Agent defaults by role section of the Agents settings of a repository. The Spec role uses Vega 2 Pro on OpenCode, with the plan profile and the effort medium. You open its model picker. The rail on the left shows Favorites, OpenCode, Codex, Claude, and Antigravity. You select Codex, Claude, and then Antigravity, and the list shows the models of each runtime. You select Gemini 4 Comet on Antigravity. The model keeps the effort medium, and you drag the effort slider to xhigh. The label over the thumb follows it. You close the picker. Now Spec uses Antigravity, the Planner uses GPT-6-Astra on Codex at the Fast speed, the Builder uses Lyra 3 on Claude, and QA uses Vega 2 Pro on OpenCode."
    >
      <SettingsPane className="rt-pane" data-pane>
        <div className="set-content">
          <RoleDefaults>
            {ROLE_DEFAULTS.map((item) => (
              <RoleDefault
                {...item}
                key={item.role}
                picker={
                  item.role === "spec" && (
                    <ModelPicker
                      view={SPEC_AFTER.runtime}
                      value={SPEC_AFTER}
                      options={[SPEC_BEFORE, SPEC_AFTER]}
                    />
                  )
                }
              />
            ))}
          </RoleDefaults>
        </div>
        <Tooltip />
        <Pointer />
      </SettingsPane>
    </SceneFrame>
  );
}
