import type * as React from "react";
import { cn } from "@/lib/utils";
import { FIELD_CHROME_CLASS_NAME } from "./input";

type TextareaProps = React.ComponentProps<"textarea"> & {
  /** The parent draws the border and the focus, as in an editor with a toolbar. */
  embedded?: boolean;
};

function Textarea({ className, ref, embedded = false, ...props }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground",
        embedded ? "bg-transparent" : FIELD_CHROME_CLASS_NAME,
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
