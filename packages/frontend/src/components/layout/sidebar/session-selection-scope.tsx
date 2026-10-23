import type { SidebarSessionGrouping } from "@openducktor/contracts";
import { type ReactElement, type ReactNode, useMemo } from "react";
import { useVisibleSessionTarget } from "@/features/session-navigation/visible-session-target";
import type { SessionNavigationModel } from "@/state/read-models/session-navigation-read-model";
import { SessionSelectionContext, selectSessionEntry } from "./session-navigation-selection";
import { useRevealSelectedSession } from "./use-reveal-selected-session";

/**
 * The scroll region of the session list. Only this scope and the rows read the visible target,
 * so a session switch does not render the sidebar, its session model, or the list again.
 */
export function SessionSelectionScope({
  model,
  grouping,
  mode,
  className,
  children,
}: {
  model: SessionNavigationModel;
  grouping: SidebarSessionGrouping;
  mode: "list" | "rail";
  className: string;
  children: ReactNode;
}): ReactElement {
  const target = useVisibleSessionTarget();
  const { visibleKey, entryKey } = selectSessionEntry(model, target, grouping);
  const selection = useMemo(() => ({ visibleKey, entryKey }), [visibleKey, entryKey]);
  const scrollRegionRef = useRevealSelectedSession(model, selection, mode);
  return (
    <SessionSelectionContext value={selection}>
      <div
        ref={scrollRegionRef}
        className={className}
        data-sidebar-scroll-region={mode === "list" ? "sessions" : undefined}
      >
        {children}
      </div>
    </SessionSelectionContext>
  );
}
