// The details of a transition: EventInspector of inspector/event-inspector.tsx and
// EventSendersField of event-senders-field.tsx in packages/frontend/src/features/workflows/editor.
// The header with the summary of event-summary.ts, the problems of the transition, the Name
// field, the Route card with the From chips of toggle-chips.tsx and the To select, and the
// Triggers card: the board buttons, Add a button, and the Agents row of a workflow without a role
// that can move the task. A scene hides the problems and shows the button row with `hidden`, and
// switches the help line with `data-triggered`.
import { Bot, Check, ChevronRight, MousePointerClick, Plus, Spline, Zap } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { Button } from "../ui/Button";
import { IconTile } from "./IconTile";
import {
  AddLink,
  ElementProblems,
  Field,
  InspectorHeader,
  PanelCard,
  QuietInput,
  QuietSelect,
} from "./InspectorParts";
import type { CanvasState } from "./model";
import { EVENT_INSPECTOR_TEXT } from "./text";
import "./tones.css";
import "./EventInspector.css";

/** A transition with one source and one target, and what the details say about it. */
export type InspectedEvent = {
  readonly name: string;
  readonly from: string;
  readonly to: CanvasState;
  /** The summary before and after a board button sends the transition. */
  readonly summary: { readonly untriggered: string; readonly triggered: string };
  /** The warning of a transition that nothing triggers. */
  readonly problem: string;
};

type EventInspectorProps = {
  event: InspectedEvent;
  states: readonly CanvasState[];
  /** A board button sends the transition. */
  triggered: boolean;
};

export function EventInspector({ event, states, triggered }: EventInspectorProps): ReactElement {
  const text = EVENT_INSPECTOR_TEXT;
  return (
    <div className="wfe-inspector" data-inspector="event" data-triggered={flag(triggered)}>
      <InspectorHeader
        Icon={Spline}
        color="sky"
        kind={text.kind}
        name={event.name}
        help={
          <>
            <span className="wfe-help-untriggered">{event.summary.untriggered}</span>
            <span className="wfe-help-triggered">{event.summary.triggered}</span>
          </>
        }
      />
      <div className="wfe-ins-body">
        <ElementProblems message={event.problem} hidden={triggered} />
        <PanelCard>
          <Field label={text.name}>
            <QuietInput value={event.name} />
          </Field>
        </PanelCard>
        <PanelCard title={text.route} Icon={Spline} color="sky">
          <Field label={text.from}>
            <span className="wfe-chips">
              {states.map((state) => (
                <span className="wfe-chip" data-on={flag(state.id === event.from)} key={state.id}>
                  <span className="wfe-dot">
                    <i className="wfe-accent" data-tone={state.tone} />
                  </span>
                  {state.label}
                  {state.id === event.from ? <Check /> : null}
                </span>
              ))}
            </span>
          </Field>
          <div className="wfe-field">
            <Field label={text.to}>
              <QuietSelect>
                <span className="wfe-dot">
                  <i className="wfe-accent" data-tone={event.to.tone} />
                </span>
                {event.to.label}
              </QuietSelect>
            </Field>
            <AddLink label={text.branch} />
          </div>
        </PanelCard>
        <PanelCard title={text.triggers} Icon={Zap} color="amber">
          <div className="wfe-senders">
            <div className="wfe-buttons">
              <span className="wfe-sender" data-trigger-row="" hidden={!triggered}>
                <IconTile Icon={MousePointerClick} color="amber" size="sm" />
                <span className="wfe-sender-text">
                  <b>{event.name}</b>
                  <span>{text.boardButton}</span>
                </span>
                <ChevronRight />
              </span>
              <AddLink label={text.addButton} data-add-button />
            </div>
            <div className="wfe-agents">
              <IconTile Icon={Bot} color="emerald" size="sm" />
              <span className="wfe-sender-text">
                <b>{text.agents}</b>
                <span>{text.agentsHint}</span>
              </span>
              <Button variant="outline" size="sm" className="wfe-pick">
                <Plus className="i14" />
                {text.pick}
              </Button>
            </div>
          </div>
        </PanelCard>
      </div>
    </div>
  );
}
