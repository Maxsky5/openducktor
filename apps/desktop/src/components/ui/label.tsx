import { cn } from "@/lib/utils";
import type * as React from "react";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: This primitive forwards htmlFor/child control linkage from call sites.
  return <label className={cn("text-sm font-medium text-slate-700", className)} {...props} />;
}

export { Label };
