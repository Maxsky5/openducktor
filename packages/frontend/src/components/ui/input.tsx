import type * as React from "react";
import { cn } from "@/lib/utils";

/** The border, surface, and focus of a standalone text field. */
export const FIELD_CHROME_CLASS_NAME =
  "rounded-md border border-input bg-card shadow-sm transition-colors focus-visible:border-input-focus read-only:bg-muted/60";

type InputProps = React.ComponentProps<"input"> & {
  /** The parent draws the border and the focus, as in an input group. */
  embedded?: boolean;
};

function Input({ className, type = "text", embedded = false, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full px-3 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 read-only:text-muted-foreground",
        embedded ? "bg-transparent" : FIELD_CHROME_CLASS_NAME,
        className,
      )}
      {...props}
    />
  );
}

export { Input };
