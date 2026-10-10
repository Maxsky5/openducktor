import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { isUserStartedTab } from "@/features/terminals";
import type { PanelId } from "./panel-tab-kinds";
import type { ResolvedPanelTab } from "./session-panel-layout";
import { useRightPanelOpen } from "./use-right-panel-open";

/** `slide` moves a panel in and out like a sheet. `instant` shows or hides it at once. */
export type PanelMotion = "slide" | "instant";

/**
 * How a panel shows on the page. An opening or closing panel slides, and the page tells the
 * controller when the slide ends.
 */
export type PanelPresence = "opening" | "open" | "closing" | "closed";

type PanelPresences = Record<PanelId, PanelPresence>;
type PanelMotions = Record<PanelId, PanelMotion>;
type PanelCounts = Record<PanelId, number>;

type OwnerViewState = {
  ownerKey: string | null;
  /** Implicit visibility follows the terminals that the user started. */
  bottomVisibility: { value: boolean; isExplicit: boolean };
  /** The shown bottom tabs of the last render, so the panel can hide when it loses its last tab. */
  bottomTabCount: number;
  focusRequest: PanelCounts;
  /** How the next visibility change of each panel shows. */
  motion: PanelMotions;
  presence: PanelPresences;
};

export type SessionPanelVisibility = {
  /** The visibility that the user asked for. A closing panel is not open. */
  isRightOpen: boolean;
  isBottomOpen: boolean;
  presence: PanelPresences;
  focusRequest: PanelCounts;
  setBottomOpen: (value: boolean, motion?: PanelMotion) => void;
  toggleRight: () => void;
  /** Hides the right panel at once, as after a drag that made it zero wide. */
  hideRightAtOnce: () => void;
  requestFocus: (panel: PanelId) => void;
  /** Ends the slide of each panel. */
  settleRight: () => void;
  settleBottom: () => void;
};

const initialOwnerViewState = (ownerKey: string | null): OwnerViewState => ({
  ownerKey,
  bottomVisibility: { value: false, isExplicit: false },
  bottomTabCount: 0,
  focusRequest: { right: 0, bottom: 0 },
  motion: { right: "instant", bottom: "instant" },
  presence: { right: "closed", bottom: "closed" },
});

const nextPresence = (
  current: PanelPresence,
  isOpen: boolean,
  motion: PanelMotion,
): PanelPresence => {
  if (isOpen) {
    if (current === "open" || current === "opening") return current;
    return motion === "slide" ? "opening" : "open";
  }
  if (current === "closed" || current === "closing") return current;
  return motion === "slide" ? "closing" : "closed";
};

const settledPresence = (presence: PanelPresence): PanelPresence => {
  if (presence === "opening") return "open";
  if (presence === "closing") return "closed";
  return presence;
};

const isBottomPanelShown = (
  state: OwnerViewState,
  bottomTabs: readonly ResolvedPanelTab[],
): boolean => {
  if (state.ownerKey === null) return false;
  if (state.bottomVisibility.isExplicit) return state.bottomVisibility.value;
  return bottomTabs.some((tab) => tab.kind === "terminal" && isUserStartedTab(tab.terminal));
};

/**
 * Applies the rules that follow a render. The bottom panel hides when it loses its last tab, by a
 * close, a move, or a host list that no longer has its terminals. An empty panel that the user
 * opens stays open. Returns the same state when no rule applies.
 */
const syncOwnerViewState = (
  state: OwnerViewState,
  bottomTabs: readonly ResolvedPanelTab[],
  isRightOpen: boolean,
): OwnerViewState => {
  const lostLastTab = state.bottomTabCount > 0 && bottomTabs.length === 0;
  let counted = state;
  if (lostLastTab) {
    counted = {
      ...state,
      bottomTabCount: 0,
      bottomVisibility: { value: false, isExplicit: true },
      motion: { ...state.motion, bottom: "slide" },
    };
  } else if (state.bottomTabCount !== bottomTabs.length) {
    counted = { ...state, bottomTabCount: bottomTabs.length };
  }
  const right = nextPresence(counted.presence.right, isRightOpen, counted.motion.right);
  const bottom = nextPresence(
    counted.presence.bottom,
    isBottomPanelShown(counted, bottomTabs),
    counted.motion.bottom,
  );
  if (right === counted.presence.right && bottom === counted.presence.bottom) return counted;
  return { ...counted, presence: { right, bottom } };
};

/**
 * Owns which panels of the selected owner show, how they slide, and their focus requests. The
 * right panel open state is global. The bottom panel state resets when the owner changes.
 */
export function useSessionPanelVisibility(
  ownerKey: string | null,
  bottomTabs: readonly ResolvedPanelTab[],
): SessionPanelVisibility {
  const rightPanel = useRightPanelOpen();
  const isRightOpen = ownerKey !== null && rightPanel.isOpen;
  const [viewState, setViewState] = useState(() => initialOwnerViewState(ownerKey));
  const view = syncOwnerViewState(
    viewState.ownerKey === ownerKey ? viewState : initialOwnerViewState(ownerKey),
    bottomTabs,
    isRightOpen,
  );
  if (view !== viewState) setViewState(view);

  const ownerKeyRef = useRef(ownerKey);
  useLayoutEffect(() => {
    ownerKeyRef.current = ownerKey;
  });
  const updateView = useCallback((change: (state: OwnerViewState) => OwnerViewState): void => {
    const currentOwnerKey = ownerKeyRef.current;
    setViewState((state) => (state.ownerKey === currentOwnerKey ? change(state) : state));
  }, []);
  const setBottomOpen = useCallback(
    (value: boolean, motion: PanelMotion = "slide"): void =>
      updateView((state) => ({
        ...state,
        bottomVisibility: { value, isExplicit: true },
        motion: { ...state.motion, bottom: motion },
      })),
    [updateView],
  );
  const { toggle, close } = rightPanel;
  const toggleRight = useCallback((): void => {
    updateView((state) => ({ ...state, motion: { ...state.motion, right: "slide" } }));
    toggle();
  }, [toggle, updateView]);
  const hideRightAtOnce = useCallback((): void => {
    updateView((state) => ({ ...state, motion: { ...state.motion, right: "instant" } }));
    close();
  }, [close, updateView]);
  const requestFocus = useCallback(
    (panel: PanelId): void =>
      updateView((state) => ({
        ...state,
        focusRequest: { ...state.focusRequest, [panel]: state.focusRequest[panel] + 1 },
      })),
    [updateView],
  );
  const settle = useCallback(
    (panel: PanelId): void =>
      updateView((state) => {
        const presence = settledPresence(state.presence[panel]);
        return presence === state.presence[panel]
          ? state
          : { ...state, presence: { ...state.presence, [panel]: presence } };
      }),
    [updateView],
  );
  const settleRight = useCallback((): void => settle("right"), [settle]);
  const settleBottom = useCallback((): void => settle("bottom"), [settle]);

  return {
    isRightOpen,
    isBottomOpen: isBottomPanelShown(view, bottomTabs),
    presence: view.presence,
    focusRequest: view.focusRequest,
    setBottomOpen,
    toggleRight,
    hideRightAtOnce,
    requestFocus,
    settleRight,
    settleBottom,
  };
}
