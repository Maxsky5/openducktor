import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";

export function TaskDescriptionEditorLoading(): ReactElement {
  return (
    <div
      className="overflow-hidden rounded-md border border-input bg-card"
      role="status"
      aria-label="Loading Visual editor"
    >
      <div className="h-11 border-b border-border bg-muted/30" aria-hidden="true" />
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Loading Visual editor…
      </div>
    </div>
  );
}
