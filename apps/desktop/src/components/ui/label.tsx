import type * as React from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: This primitive forwards htmlFor/child control linkage from call sites.
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export { Label };
