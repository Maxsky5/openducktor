import { EllipsisVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "group relative flex h-full w-8 shrink-0 items-center justify-center focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-1 focus-visible:outline-none aria-[orientation=horizontal]:h-3 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize aria-[orientation=vertical]:cursor-col-resize",
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-300 transition-colors duration-200 group-hover:bg-blue-500 aria-[orientation=horizontal]:left-0 aria-[orientation=horizontal]:top-1/2 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:-translate-y-1/2 aria-[orientation=horizontal]:translate-x-0"
        aria-hidden="true"
      />
      {withHandle && (
        <div className="relative z-10 flex h-8 w-4 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-150 group-hover:border-blue-500 group-hover:bg-blue-50 group-hover:text-blue-600 aria-[orientation=horizontal]:-rotate-90">
          <EllipsisVertical className="size-3.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
