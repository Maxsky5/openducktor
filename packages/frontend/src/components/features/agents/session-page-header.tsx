import type { ReactElement, ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

export function SessionPageHeader({
  title,
  actions,
  openIn,
  viewControls,
}: {
  title: ReactNode;
  actions: ReactNode;
  openIn: ReactNode;
  viewControls: ReactNode;
}): ReactElement {
  return (
    <TooltipProvider disableHoverableContent>
      <header className="electron-titlebar-safe-area @container/session-header flex h-10 min-w-0 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
        <div className="min-w-0 flex-1">{title}</div>
        <div className="flex shrink-0 items-center gap-2">
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          {openIn ? (
            <div className="flex items-center @max-[640px]/session-header:[&_button>span]:hidden">
              {openIn}
            </div>
          ) : null}
          {viewControls}
        </div>
      </header>
    </TooltipProvider>
  );
}
