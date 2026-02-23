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
        "group relative flex w-4 items-center justify-center border-x border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100/80 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-1 focus-visible:outline-none aria-[orientation=horizontal]:h-3 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:border-x-0 aria-[orientation=horizontal]:border-y",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div
          aria-hidden="true"
          className="pointer-events-none inline-flex items-center justify-center gap-[2px]"
        >
          <span className="h-8 w-1 rounded-full bg-slate-300 transition-colors group-hover:bg-slate-400 aria-[orientation=horizontal]:h-1 aria-[orientation=horizontal]:w-8" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
