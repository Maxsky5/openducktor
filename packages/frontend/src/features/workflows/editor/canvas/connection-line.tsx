import {
  type ConnectionLineComponentProps,
  getBezierPath,
  Position,
  type XYPosition,
} from "@xyflow/react";
import type { ReactElement } from "react";
import { STATE_BOX_HEIGHT, STATE_BOX_WIDTH } from "../model/canvas-layout";
import { arrowSides, type Side } from "./edge-routes";
import type { StateNodeType } from "./state-node";

const POSITIONS = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
} satisfies Record<Side, Position>;

/** The middle of one side of a box. */
const sidePoint = ({ x, y }: XYPosition, side: Side): XYPosition => {
  if (side === "top") return { x: x + STATE_BOX_WIDTH / 2, y };
  if (side === "bottom") return { x: x + STATE_BOX_WIDTH / 2, y: y + STATE_BOX_HEIGHT };
  if (side === "left") return { x, y: y + STATE_BOX_HEIGHT / 2 };
  return { x: x + STATE_BOX_WIDTH, y: y + STATE_BOX_HEIGHT / 2 };
};

/**
 * The line of a new transition while the user drags it. Over a state box, it ends on the side
 * that faces the drag, as the drawn arrow will. The target dot covers the whole box during a drag,
 * so the default line would end at its left side and loop around a box below or above.
 */
export function ConnectionLine({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
  toNode,
}: ConnectionLineComponentProps<StateNodeType>): ReactElement {
  let target = { x: toX, y: toY, position: toPosition };
  if (toNode) {
    const box = toNode.internals.positionAbsolute;
    const [, side] = arrowSides(
      { x: fromX, y: fromY, width: 0, height: 0 },
      { ...box, width: STATE_BOX_WIDTH, height: STATE_BOX_HEIGHT },
    );
    target = { ...sidePoint(box, side), position: POSITIONS[side] };
  }
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: target.x,
    targetY: target.y,
    targetPosition: target.position,
  });
  return <path d={path} fill="none" className="react-flow__connection-path" />;
}
