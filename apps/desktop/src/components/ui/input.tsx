import type * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-sky-500/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
