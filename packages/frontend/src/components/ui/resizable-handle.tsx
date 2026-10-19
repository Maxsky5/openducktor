import { EllipsisVertical } from "lucide-react";
import type { ReactElement } from "react";
import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/lib/utils";

/**
 * The separator is the 1px line between two panels, and its grip sits on the line. The library
 * makes the pointer target wider and sets `data-separator` while the pointer is over that target.
 */
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
        "group relative flex h-full w-px shrink-0 items-center justify-center bg-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none data-[separator=active]:bg-selected-accent data-[separator=hover]:bg-selected-accent aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize aria-[orientation=vertical]:cursor-col-resize",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <div className="relative z-10 flex h-8 w-4 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm group-data-[separator=active]:border-selected-accent group-data-[separator=active]:bg-accent group-data-[separator=active]:text-selected-accent group-data-[separator=hover]:border-selected-accent group-data-[separator=hover]:bg-accent group-data-[separator=hover]:text-selected-accent group-aria-[orientation=horizontal]:h-4 group-aria-[orientation=horizontal]:w-8">
          <EllipsisVertical className="size-3.5 shrink-0 group-aria-[orientation=horizontal]:rotate-90" />
        </div>
      ) : null}
    </ResizablePrimitive.Separator>
  );
}
