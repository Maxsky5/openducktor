import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { CircleIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

function RadioGroupSegmentItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-segment-item"
      // Keyboard focus lands on the checked item, so its ring gives way to the focus ring.
      className={cn(
        "inline-flex h-6 flex-1 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground outline-none transition-[background-color,color,box-shadow] hover:bg-segmented-selected/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:bg-segmented-selected data-[state=checked]:text-foreground data-[state=checked]:shadow-sm data-[state=checked]:not-focus-visible:ring-1 data-[state=checked]:not-focus-visible:ring-input",
        className,
      )}
      {...props}
    />
  );
}

export { RadioGroup, RadioGroupItem, RadioGroupSegmentItem };
