import * as TabsPrimitive from "@radix-ui/react-tabs";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px]",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  onMouseDown,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 text-xs font-medium text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      onMouseDown={(event) => {
        onMouseDown?.(event);
        // Radix focuses the tab from script on mouse down. Chromium then keeps the keyboard focus
        // state of the field that had focus, so a click after typing would show the focus ring.
        if (!event.defaultPrevented && event.button === 0 && !event.ctrlKey) {
          event.currentTarget.focus({ focusVisible: false });
        }
      }}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

/**
 * The IDs that link a trigger and its content. Radix makes them from the `Tabs` root of each part,
 * so a content under another root, as in a portal, needs both parts to use one base.
 */
function tabLinkIds(base: string, value: string) {
  const triggerId = `${base}-trigger-${value}`;
  const contentId = `${base}-content-${value}`;
  return {
    trigger: { id: triggerId, "aria-controls": contentId },
    content: { id: contentId, "aria-labelledby": triggerId },
  };
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabLinkIds };
