import { EllipsisVertical } from "lucide-react";
import type { ReactElement } from "react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

type PanelGroupDirection = "horizontal" | "vertical";

type ResizablePanelGroupProps = ResizablePrimitive.GroupProps & {
  direction?: PanelGroupDirection;
};

function ResizablePanelGroup({
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

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps): ReactElement {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}): ReactElement {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "group relative flex h-full w-2 shrink-0 items-center justify-center focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:outline-none aria-[orientation=horizontal]:h-3 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize aria-[orientation=vertical]:cursor-col-resize",
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-input transition-colors duration-200 group-hover:bg-primary aria-[orientation=horizontal]:left-0 aria-[orientation=horizontal]:top-1/2 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:-translate-y-1/2 aria-[orientation=horizontal]:translate-x-0"
        aria-hidden="true"
      />
      {withHandle && (
        <div className="relative z-10 flex h-8 w-4 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-all duration-150 group-hover:border-primary group-hover:bg-accent group-hover:text-primary aria-[orientation=horizontal]:-rotate-90">
          <EllipsisVertical className="size-3.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
