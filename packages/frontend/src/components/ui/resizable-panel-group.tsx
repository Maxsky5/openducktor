import type { ReactElement } from "react";
import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/lib/utils";

type PanelGroupDirection = "horizontal" | "vertical";

type ResizablePanelGroupProps = ResizablePrimitive.GroupProps & {
  direction?: PanelGroupDirection;
};

export function ResizablePanelGroup({
  direction,
  orientation,
  className,
  ...props
}: ResizablePanelGroupProps): ReactElement {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
      orientation={orientation ?? direction}
      {...props}
    />
  );
}
