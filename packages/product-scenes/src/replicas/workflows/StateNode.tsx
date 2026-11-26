// A state box of the workflow canvas: StateNode of canvas/state-node.tsx in
// packages/frontend/src/features/workflows/editor. The tone tile with the icon of the state, the
// label, and the four connection dots of React Flow handles. The box sits at
// its flow position in `--x` and `--y`. A scene sets `data-emphasis`, `data-hover` while the
// pointer rests on the box, `data-drop` while a new transition can end on it, and `data-active` on
// the dot under the pointer.
import { CircleCheckBig, Columns3, Inbox } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import type { Point } from "../../motion/offset";
import { type CanvasState, type StateIcon, stateIcon } from "./model";
import "./StateNode.css";

const ICONS = { open: Inbox, work: Columns3, closed: CircleCheckBig } satisfies Record<
  StateIcon,
  typeof Inbox
>;

/** The sides of the source dots, in the order of SOURCE_SIDES of state-node.tsx. */
const SIDES = ["top", "right", "bottom", "left"] as const;

type StateNodeProps = { state: CanvasState; at: Point };

export function StateNode({ state, at }: StateNodeProps): ReactElement {
  const Icon = ICONS[stateIcon(state.id)];
  const place: CSSProperties & { "--x": number; "--y": number } = { "--x": at.x, "--y": at.y };
  return (
    <div className="wfe-node" data-node={state.id} style={place}>
      <span className="wfe-node-tile" data-tone={state.tone}>
        <Icon />
      </span>
      <span className="wfe-node-label">{state.label}</span>
      {SIDES.map((side) => (
        <i className="wfe-node-dot" data-side={side} key={side} />
      ))}
    </div>
  );
}
