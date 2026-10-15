import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function HeaderNotice({
  tone,
  id,
  testId,
  children,
}: {
  tone: "warning" | "error" | "muted";
  id?: string;
  testId?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <p
      id={id}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "border-b border-border px-3 py-1.5 text-xs",
        tone === "warning" && "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
        tone === "error" && "bg-destructive/10 text-destructive",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
      data-testid={testId}
    >
      {children}
    </p>
  );
}
