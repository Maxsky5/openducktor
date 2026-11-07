// ResizableHandle withHandle of components/ui/resizable-handle.tsx. A vertical handle sits between
// two columns, and a horizontal handle sits between two rows.
import { EllipsisVertical } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import "./ResizeHandle.css";

type ResizeHandleProps = ComponentProps<"div"> & { orientation: "vertical" | "horizontal" };

export function ResizeHandle({
  orientation,
  className,
  ...attributes
}: ResizeHandleProps): ReactElement {
  return (
    <div className={classes("ui-handle", className)} data-orientation={orientation} {...attributes}>
      <span className="ui-handle-grip">
        <EllipsisVertical className="i14" />
      </span>
    </div>
  );
}
