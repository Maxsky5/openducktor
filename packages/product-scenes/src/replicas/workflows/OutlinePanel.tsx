// The element list of the workflow editor: outline-panel.tsx and outline-group.tsx in
// packages/frontend/src/features/workflows/editor/panels. The search, the Workflow settings card,
// the sections with their tile, title, count, fold chevron, and add button, the rows of the states
// and the transitions, and the Advanced card. A scene sets `data-current` on the selected row,
// shows a row marker with `hidden`, and changes a count.
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Columns3,
  FileText,
  ListChecks,
  type LucideIcon,
  MousePointerClick,
  MoveRight,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Spline,
  Tag,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import { IconTile, type KindColor } from "./IconTile";
import type { CanvasState } from "./model";
import { OUTLINE_SECTIONS, OUTLINE_TEXT, type OutlineSectionId } from "./text";
import "./tones.css";
import "./OutlinePanel.css";

/** A row of the Transitions section: its name and its route, or No trigger yet. */
export type OutlineTransition = {
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly triggered: boolean;
};

/** The icon and the colour of each section: KIND_THEME of kind-styles.ts. */
const SECTION_KINDS = {
  states: { Icon: Columns3, color: "violet" },
  transitions: { Icon: Spline, color: "sky" },
  buttons: { Icon: MousePointerClick, color: "amber" },
  roles: { Icon: Bot, color: "emerald" },
  steps: { Icon: ListChecks, color: "indigo" },
  artifacts: { Icon: FileText, color: "rose" },
  issueTypes: { Icon: Tag, color: "teal" },
} as const satisfies Record<OutlineSectionId, { Icon: LucideIcon; color: KindColor }>;

type SectionProps = {
  id: OutlineSectionId;
  /** The count in the header. Zero hides it, as for an empty section. */
  count: number;
  /** The rows of an open section. A folded section has none. */
  children?: ReactNode;
};

function Section({ id, count, children }: SectionProps): ReactElement {
  const { Icon, color } = SECTION_KINDS[id];
  return (
    <div className="wfe-section" data-outline-section={id}>
      <div className="wfe-section-head">
        <span className="wfe-section-toggle" data-open={flag(children !== undefined)}>
          <IconTile Icon={Icon} color={color} size="sm" />
          <span className="wfe-section-title">{OUTLINE_SECTIONS[id]}</span>
          <span className="wfe-count" data-count="" hidden={count === 0}>
            {count}
          </span>
          <ChevronDown className="wfe-section-chevron" />
        </span>
        <span className="wfe-section-add">
          <Plus />
        </span>
      </div>
      {children === undefined ? null : <ul className="wfe-rows">{children}</ul>}
    </div>
  );
}

/** ProblemMarker of problem-marker.tsx for a warning: a size-3.5 triangle in text-warning-muted. */
function RowMarker(): ReactElement {
  return (
    <span className="wfe-row-marker" data-row-problem="" hidden>
      <AlertTriangle />
    </span>
  );
}

/** A setting card of the list: Workflow settings, or the Advanced group. */
function CardRow({ title, Icon }: { title: string; Icon: LucideIcon }): ReactElement {
  return (
    <span className="wfe-row wfe-card-row">
      <IconTile Icon={Icon} color="slate" />
      <span className="wfe-card-title">{title}</span>
      <ChevronRight />
    </span>
  );
}

type OutlinePanelProps = {
  states: readonly CanvasState[];
  transitions: readonly OutlineTransition[];
  buttons: number;
  issueTypes: number;
};

export function OutlinePanel({
  states,
  transitions,
  buttons,
  issueTypes,
}: OutlinePanelProps): ReactElement {
  return (
    <div className="wfe-outline">
      <div className="wfe-search-bar">
        <span className="wfe-search">
          <Search />
          {OUTLINE_TEXT.search}
        </span>
      </div>
      <div className="wfe-outline-scroll">
        <div className="wfe-settings">
          <CardRow title={OUTLINE_TEXT.settings} Icon={Settings2} />
        </div>
        <Section id="states" count={states.length}>
          {states.map((state) => (
            <li key={state.id} data-outline-row={`state:${state.id}`}>
              <span className="wfe-row">
                <span className="wfe-dot">
                  <i className="wfe-accent" data-tone={state.tone} />
                </span>
                <span className="wfe-row-text">{state.label}</span>
                <RowMarker />
              </span>
            </li>
          ))}
        </Section>
        <Section id="transitions" count={transitions.length}>
          {transitions.map((transition) => (
            <li key={transition.id} data-outline-row={`event:${transition.id}`}>
              <span className="wfe-row">
                <MoveRight className="wfe-row-icon" />
                <span className="wfe-row-text">
                  <span>{transition.name}</span>
                  <small data-route="" hidden={!transition.triggered}>
                    {transition.route}
                  </small>
                  <small
                    className="wfe-no-trigger"
                    data-no-trigger=""
                    hidden={transition.triggered}
                  >
                    {OUTLINE_TEXT.noTrigger}
                  </small>
                </span>
                <RowMarker />
              </span>
            </li>
          ))}
        </Section>
        <Section id="buttons" count={buttons} />
        <Section id="roles" count={0} />
        <Section id="steps" count={0} />
        <Section id="artifacts" count={0} />
        <Section id="issueTypes" count={issueTypes} />
        <div className="wfe-advanced">
          <CardRow title={OUTLINE_TEXT.advanced} Icon={SlidersHorizontal} />
        </div>
      </div>
    </div>
  );
}
