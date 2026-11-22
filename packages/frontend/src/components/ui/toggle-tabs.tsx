import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * One choice of a few options, such as a filter or a view, with the look of `TabsList`. It has
 * radio semantics: the arrow keys move the choice, and no tab panel is needed.
 */
function ToggleTabs<Value extends string>({
  className,
  value,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive.Root>, "value" | "onValueChange"> & {
  value: Value;
  onValueChange: (value: Value) => void;
}) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="toggle-tabs"
      orientation="horizontal"
      value={value}
      onValueChange={(next) =>
        // SAFETY: Radix reports only the value of an item of this group, and the items take
        // their values from the same `Value` union as `value`.
        onValueChange(next as Value)
      }
      className={cn(
        "inline-flex h-9 w-fit items-center rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ToggleTabsItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="toggle-tabs-item"
      className={cn(
        "inline-flex h-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-3 text-[13px] font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-border data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleTabs, ToggleTabsItem };
