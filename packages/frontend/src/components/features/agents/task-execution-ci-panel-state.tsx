import type { ReactElement } from "react";

export function TaskExecutionCiPanelState({ message }: { message: string }): ReactElement {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
