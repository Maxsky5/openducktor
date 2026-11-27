// The details of a state: StateInspector of inspector/state-inspector.tsx in
// packages/frontend/src/features/workflows/editor. The header, the problems of the state, the
// Name and Colour fields of ToneField in choice-fields.tsx, the Transitions card of
// state-transitions.tsx for a state that no transition links yet, and the Notification and Agent
// Studio cards. A scene hides the problems with `hidden`.
import { Bell, Bot, Columns3, Spline } from "lucide-react";
import type { ReactElement } from "react";
import { Switch } from "../ui/Switch";
import {
  AddLink,
  ElementProblems,
  Field,
  InspectorHeader,
  PanelCard,
  QuietInput,
  QuietSelect,
} from "./InspectorParts";
import { type CanvasState, STATE_TONES } from "./model";
import { addTransitionFrom, STATE_INSPECTOR_TEXT } from "./text";
import "./tones.css";
import "./StateInspector.css";

type StateInspectorProps = {
  state: CanvasState;
  /** The warning of the state, as the workflow check writes it. */
  problem: string;
};

export function StateInspector({ state, problem }: StateInspectorProps): ReactElement {
  const text = STATE_INSPECTOR_TEXT;
  return (
    <div className="wfe-inspector" data-inspector="state">
      <InspectorHeader Icon={Columns3} color="violet" kind={text.kind} name={state.label} />
      <div className="wfe-ins-body">
        <ElementProblems message={problem} />
        <PanelCard>
          <Field label={text.name}>
            <QuietInput value={state.label} />
          </Field>
          <Field label={text.colour}>
            <span className="wfe-swatches">
              {STATE_TONES.map((tone) => (
                <span
                  className="wfe-swatch"
                  data-checked={tone === state.tone ? "" : undefined}
                  key={tone}
                >
                  <i className="wfe-accent" data-tone={tone} />
                </span>
              ))}
            </span>
          </Field>
        </PanelCard>
        <PanelCard title={text.transitions} Icon={Spline} color="sky">
          <Field label={text.comesFrom}>
            <p className="wfe-ins-empty">{text.noneIn}</p>
          </Field>
          <Field label={text.goesTo}>
            <p className="wfe-ins-empty">{text.noneOut}</p>
          </Field>
          <AddLink label={addTransitionFrom(state.label)} />
        </PanelCard>
        <PanelCard
          title={text.notification}
          description={text.notificationHint}
          Icon={Bell}
          color="amber"
          actions={<Switch />}
        />
        <PanelCard title={text.studio} description={text.studioHint} Icon={Bot} color="emerald">
          <Field label={text.session}>
            <QuietSelect>{text.automatic}</QuietSelect>
          </Field>
        </PanelCard>
      </div>
    </div>
  );
}
