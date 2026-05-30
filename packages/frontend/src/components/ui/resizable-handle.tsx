import { EllipsisVertical } from "lucide-react";
import type { ReactElement } from "react";
import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/lib/utils";

export function ResizableHandle({
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
        className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-input transition-colors duration-200 group-hover:bg-selected-accent group-aria-[orientation=horizontal]:left-0 group-aria-[orientation=horizontal]:top-1/2 group-aria-[orientation=horizontal]:h-px group-aria-[orientation=horizontal]:w-full group-aria-[orientation=horizontal]:-translate-y-1/2 group-aria-[orientation=horizontal]:translate-x-0"
        aria-hidden="true"
      />
      {withHandle ? (
        <div className="relative z-10 flex h-8 w-4 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-all duration-150 group-hover:border-selected-accent group-hover:bg-accent group-hover:text-selected-accent group-aria-[orientation=horizontal]:h-4 group-aria-[orientation=horizontal]:w-8">
          <EllipsisVertical className="size-3.5 shrink-0 group-aria-[orientation=horizontal]:rotate-90" />
        </div>
      ) : null}
    </ResizablePrimitive.Separator>
  );
}
