import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const segmentedControlRootVariants = cva("inline-flex items-center bg-muted p-1", {
  variants: {
    size: {
      sm: "h-9 gap-1",
      md: "h-10 gap-2 rounded-lg",
      lg: "min-h-11 gap-2 rounded-xl bg-muted/70",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const segmentedControlItemVariants = cva(
  "inline-flex cursor-pointer items-center justify-center font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      grow: {
        fill: "flex-1",
        hug: "",
      },
      size: {
        xs: "h-6 rounded-md px-2 text-[11px]",
        sm: "h-7 rounded-sm px-3 text-xs",
        md: "h-8 rounded-md px-3 text-sm",
        lg: "h-9 rounded-lg px-3 text-sm",
      },
      active: {
        true: "bg-selected-control text-selected-control-foreground shadow-sm hover:bg-selected-control/90",
        false: "text-muted-foreground hover:bg-background hover:text-foreground",
      },
    },
    defaultVariants: {
      grow: "fill",
      size: "md",
      active: false,
    },
  },
);

export type SegmentedControlRootVariantProps = VariantProps<typeof segmentedControlRootVariants>;

type SegmentedControlRootClassNameOptions = SegmentedControlRootVariantProps & {
  className?: string | undefined;
};

export type SegmentedControlItemClassNameOptions = VariantProps<
  typeof segmentedControlItemVariants
> & {
  className?: string | undefined;
  inactiveClassName?: string | undefined;
};

export function segmentedControlRootClassName({
  size,
  className,
}: SegmentedControlRootClassNameOptions = {}): string {
  return cn(segmentedControlRootVariants({ size }), className);
}

export function segmentedControlItemClassName({
  grow,
  size,
  active,
  className,
  inactiveClassName,
}: SegmentedControlItemClassNameOptions = {}): string {
  return cn(
    segmentedControlItemVariants({ grow, size, active }),
    !active && inactiveClassName,
    className,
  );
}

export function segmentedControlTriggerClassName({
  size,
  className,
  inactiveClassName,
}: Omit<SegmentedControlItemClassNameOptions, "active" | "grow"> = {}): string {
  return cn(
    segmentedControlItemVariants({ size, active: false }),
    inactiveClassName,
    "data-[state=active]:bg-selected-control data-[state=active]:text-selected-control-foreground data-[state=active]:shadow-sm data-[state=active]:hover:bg-selected-control/90",
    className,
  );
}
