import { ControlButton, useReactFlow, useStore } from "@xyflow/react";
import { ChevronsDown } from "lucide-react";
import type { ReactElement } from "react";
import type { Box } from "./canvas-geometry";

/** The space that the "More below" control keeps from the canvas bottom. */
const HINT_ROOM = 24;

/**
 * A "More below" control in the zoom controls while the workflow reaches past the canvas bottom.
 * It sits in the controls, so it covers no box. A click pans down by most of the canvas height.
 */
export function MoreBelowControl({ content }: { content: Box | null }): ReactElement | null {
  const { getViewport, setViewport } = useReactFlow();
  const hidden = useStore((state) => {
    if (content === null) return 0;
    const [, y, zoom] = state.transform;
    return Math.max(0, (content.y + content.height) * zoom + y - state.height + HINT_ROOM);
  });
  if (hidden <= 0) return null;
  return (
    <ControlButton
      className="workflow-more-below"
      title="More of the workflow is below. Click to scroll down."
      aria-label="Scroll down to more of the workflow"
      onClick={() => {
        const viewport = getViewport();
        void setViewport(
          { ...viewport, y: viewport.y - Math.min(hidden + HINT_ROOM, 480) },
          { duration: 200 },
        );
      }}
    >
      <ChevronsDown />
    </ControlButton>
  );
}
