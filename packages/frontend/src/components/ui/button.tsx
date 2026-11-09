import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        secondary: "bg-secondary/70 text-secondary-foreground hover:bg-secondary",
        ghost: "text-foreground hover:bg-accent/60",
        outline: "border border-input bg-card hover:bg-accent",
        // An on/off button, such as a filter. Set `aria-pressed`: when on, it takes the look of the
        // accent variant, the selected item of the Settings and sidebar menus.
        toggle:
          "border border-input bg-card hover:bg-accent aria-pressed:border-transparent aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground aria-pressed:hover:bg-sidebar-accent/90 aria-pressed:[--foreground:var(--sidebar-accent-foreground)] aria-pressed:[--muted-foreground:var(--sidebar-accent-foreground)]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        destructiveSoft:
          "border border-destructive-border bg-destructive-surface text-destructive-surface-foreground hover:bg-destructive-surface/80",
        destructiveGhost:
          "text-destructive-muted hover:border-destructive-border/60 hover:bg-destructive-surface/70 hover:text-destructive-surface-foreground dark:hover:bg-destructive-surface/55",
        warning:
          "border border-warning-border bg-warning-surface text-warning-muted hover:bg-warning-surface/80 hover:text-warning-surface-foreground",
        warningGhost:
          "text-warning-muted hover:border-warning-border/60 hover:bg-warning-surface/70 hover:text-warning-surface-foreground dark:hover:bg-warning-surface/55",
        // Text inside, such as a muted second line or an outline badge, takes the accent foreground.
        accent:
          "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/90 [--foreground:var(--sidebar-accent-foreground)] [--muted-foreground:var(--sidebar-accent-foreground)]",
      },
      size: {
        default: "h-9 px-4 py-2",
        xs: "h-6 rounded-md px-2 text-xs",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      data-slot="button"
      {...props}
    />
  );
}

export { Button };
