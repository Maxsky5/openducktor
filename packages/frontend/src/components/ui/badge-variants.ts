import { cva } from "class-variance-authority";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-input text-foreground",
        success: "border-transparent bg-success-surface text-success-surface-foreground",
        warning: "border-transparent bg-warning-surface text-warning-surface-foreground",
        danger: "border-transparent bg-destructive-surface text-destructive-surface-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
