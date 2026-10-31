import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const tones = {
  default: "border-border bg-muted/40 text-foreground",
  warning: "border-warning-border bg-warning-surface text-warning-surface-foreground",
  destructive:
    "border-destructive-border bg-destructive-surface text-destructive-surface-foreground",
};

/** A short notice. Use role="note" for a warning that does not need an announcement. */
export function Alert({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { variant?: keyof typeof tones }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        tones[variant],
        className,
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("font-medium leading-5", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-w-0 text-sm leading-5", className)} {...props} />;
}
