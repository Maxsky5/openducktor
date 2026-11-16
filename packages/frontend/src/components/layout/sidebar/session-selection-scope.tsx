import type { SidebarSessionGrouping } from "@openducktor/contracts";
import { type ReactElement, type ReactNode, useLayoutEffect, useMemo, useState } from "react";
import { useVisibleSessionTarget } from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import type { SessionNavigationModel } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import {
  createSessionSelectionStore,
  type SessionSelection,
  SessionSelectionContext,
  selectSessionEntry,
} from "./session-navigation-selection";
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
    <SessionSelectionProvider selection={selection}>
      <div
        ref={scrollRegionRef}
        className={className}
        data-sidebar-scroll-region={mode === "list" ? "sessions" : undefined}
      >
        {children}
      </div>
    </SessionSelectionProvider>
  );
}

/** Gives the rows a selection store that follows `selection`. */
export function SessionSelectionProvider({
  selection,
  children,
}: {
  selection: SessionSelection;
  children: ReactNode;
}): ReactElement {
  const [store] = useState(() => createSessionSelectionStore(selection));
  // Before paint, so a switch shows the new selection in the same frame.
  useLayoutEffect(() => store.set(selection), [store, selection]);
  return <SessionSelectionContext value={store}>{children}</SessionSelectionContext>;
}
