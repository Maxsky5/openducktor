import { Bot } from "lucide-react";
import type { ReactElement } from "react";

export function AppBrand(): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <div className="rounded-xl bg-sidebar-accent p-2 text-sidebar-accent-foreground shadow-md">
        <Bot className="size-5" />
      </div>
      <div>
        <p className="text-lg font-semibold tracking-tight">OpenDucktor</p>
        <p className="text-xs text-sidebar-muted-foreground">Agent Orchestration</p>
      </div>
    </div>
  );
}
