import { type RefObject, useLayoutEffect, useRef } from "react";
import type { SessionNavigationModel } from "@/state/read-models/session-navigation-read-model";
import type { SessionSelection } from "./session-navigation-selection";

/**
 * Reveal a selected session once when it opens or the sidebar changes mode.
 * Passive status, recency, and record updates must not scroll the list.
 */
export const useRevealSelectedSession = (
  model: SessionNavigationModel,
  selection: SessionSelection,
  mode: "list" | "rail",
): RefObject<HTMLDivElement | null> => {
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const lastRevealKeyRef = useRef<string | null>(null);
  const hasSelectedEntry = model.groups.some((group) =>
    group.entries.some((entry) => entry.key === selection.entryKey),
  );
  const revealKey = selection.visibleKey === null ? null : `${mode}:${selection.visibleKey}`;

  useLayoutEffect(() => {
    if (revealKey === null) {
      lastRevealKeyRef.current = null;
      return;
    }
    if (!hasSelectedEntry || revealKey === lastRevealKeyRef.current) return;
    const row = Array.from(
      scrollRegionRef.current?.querySelectorAll('[aria-current="true"]') ?? [],
    ).find((element) => !element.closest("[inert]"));
    if (!row) return;
    lastRevealKeyRef.current = revealKey;
    row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [hasSelectedEntry, revealKey]);

  return scrollRegionRef;
};
