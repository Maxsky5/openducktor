// SegmentedControlItem of components/ui/segmented-control.tsx, in a Segmented control. The active
// item has `data-active`, and a disabled item has `data-disabled`.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { flag } from "../flag";
import "./Segment.css";

type SegmentProps = ComponentProps<"span"> & { active?: boolean; disabled?: boolean };

export function Segment({
  active = false,
  disabled = false,
  className,
  ...attributes
}: SegmentProps): ReactElement {
  return (
    <span
      className={classes("ui-segment", className)}
      data-active={flag(active)}
      data-disabled={flag(disabled)}
      {...attributes}
    />
  );
}
