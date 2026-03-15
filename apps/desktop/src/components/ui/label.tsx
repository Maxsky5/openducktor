import type * as React from "react";
import { cn } from "@/lib/utils";

function Label({ className, htmlFor, children, ...props }: React.ComponentProps<"label">) {
  const LabelElement = "label";
  return (
    <LabelElement
      className={cn("text-sm font-medium text-foreground", className)}
      htmlFor={htmlFor}
      {...props}
    >
      {children}
    </LabelElement>
  );
}

export { Label };
