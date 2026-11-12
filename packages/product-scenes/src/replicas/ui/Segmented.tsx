// SegmentedControlRoot of components/ui/segmented-control.tsx. Its items are Segment elements in
// the children. The size of the root also sets the size of its items, as the product pairs them.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import "./Segmented.css";

type SegmentedProps = ComponentProps<"div"> & { size: "sm" | "md" | "lg" };

export function Segmented({ size, className, ...attributes }: SegmentedProps): ReactElement {
  return <div className={classes("ui-segmented", className)} data-size={size} {...attributes} />;
}
