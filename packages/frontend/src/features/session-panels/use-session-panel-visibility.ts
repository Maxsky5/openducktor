import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PanelId } from "./panel-tab-kinds";
import {
  type BottomPanelFacts,
  bottomStateAfterChoice,
  decideBottomPanel,
  isBottomPanelShown,
  NO_BOTTOM_CHECK,
} from "./session-panel-bottom-rules";
import {
  type ResolvedPanelTab,
  type SessionPanelOwner,
  sessionPanelOwnerKey,
} from "./session-panel-layout";
import {
  NO_SAVED_PANELS,
  type SessionPanelsOpenState,
  useSessionPanelLayoutStore,
} from "./session-panel-layout-store";

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

/** The state of one view. The open states and the bottom panel rules belong to the owner. */
type OwnerViewState = {
  ownerKey: string | null;
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
  /** Slides the right panel in when it is hidden. */
  showRight: () => void;
  /** Hides the right panel at once, as after a drag that made it zero wide. */
  hideRightAtOnce: () => void;
  requestFocus: (panel: PanelId) => void;
  /** Ends the slide of each panel. */
  settleRight: () => void;
  settleBottom: () => void;
};

const initialOwnerViewState = (ownerKey: string | null, slideRightIn: boolean): OwnerViewState => ({
  ownerKey,
  focusRequest: { right: 0, bottom: 0 },
  motion: { right: slideRightIn ? "slide" : "instant", bottom: "instant" },
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

/**
 * Follows the visibility of each panel. A bottom panel that hides by itself slides out. A hidden
 * view has no size and runs no transition, so its panels do not slide and it keeps no focus
 * request. Returns the same state when nothing changes.
 */
const syncOwnerViewState = (
  state: OwnerViewState,
  input: { isRightOpen: boolean; isBottomOpen: boolean; bottomHides: boolean; isActive: boolean },
): OwnerViewState => {
  const { isRightOpen, isBottomOpen, bottomHides, isActive } = input;
  let next = state;
  if (bottomHides && next.motion.bottom !== "slide") {
    next = { ...next, motion: { ...next.motion, bottom: "slide" } };
  }
  if (!isActive && (next.focusRequest.right > 0 || next.focusRequest.bottom > 0)) {
    next = { ...next, focusRequest: { right: 0, bottom: 0 } };
  }
  let right = nextPresence(next.presence.right, isRightOpen, next.motion.right);
  let bottom = nextPresence(next.presence.bottom, isBottomOpen, next.motion.bottom);
  if (!isActive) {
    right = settledPresence(right);
    bottom = settledPresence(bottom);
  }
  if (right === next.presence.right && bottom === next.presence.bottom) return next;
  return { ...next, presence: { right, bottom } };
};

/** The right panel shows unless the owner saved it closed. */
const isSavedRightOpen = (panels: SessionPanelsOpenState): boolean => panels.right ?? true;

type SessionPanelVisibilityInput = {
  owner: SessionPanelOwner | null;
  bottomTabs: readonly ResolvedPanelTab[];
  bottomClosingTabs: readonly ResolvedPanelTab[];
  terminalList: BottomPanelFacts["terminalList"];
  isActive: boolean;
  deferRightReveal?: boolean;
};

/**
 * Owns which panels of the selected owner show, how they slide, and their focus requests. Each task
 * and chat saves the open state of its panels in the panel layout store. Each open and close by the
 * user or an action saves the state of the owner. Only the shown view applies the automatic bottom
 * panel rules and saves their result, so a kept view of the same owner never overwrites a choice.
 */
export function useSessionPanelVisibility({
  owner,
  bottomTabs,
  bottomClosingTabs,
  terminalList,
  isActive,
  deferRightReveal = false,
}: SessionPanelVisibilityInput): SessionPanelVisibility {
  const store = useSessionPanelLayoutStore();
  const ownerKey = owner ? sessionPanelOwnerKey(owner) : null;
  const readOwnerPanels = useCallback(
    () => (owner ? store.readPanels(owner) : NO_SAVED_PANELS),
    [owner, store],
  );
  const panels = useSyncExternalStore(store.subscribe, readOwnerPanels);
  const isRightOpen = owner !== null && !deferRightReveal && isSavedRightOpen(panels);

  const facts: BottomPanelFacts = {
    tabs: bottomTabs,
    closingTabs: bottomClosingTabs,
    terminalList,
  };
  const bottomCheck = owner ? store.readBottomCheck(owner) : NO_BOTTOM_CHECK;
  const decision =
    owner !== null && isActive ? decideBottomPanel(panels.bottom, bottomCheck, facts) : null;
  const isBottomOpen =
    owner !== null && (decision ? decision.isShown : isBottomPanelShown(panels.bottom, facts));
  const bottomHides = decision?.hides ?? false;
  const nextBottomState = decision?.state ?? panels.bottom;
  const nextBottomCheck = decision?.check ?? bottomCheck;

  const [viewState, setViewState] = useState(() =>
    initialOwnerViewState(ownerKey, deferRightReveal),
  );
  const view = syncOwnerViewState(
    viewState.ownerKey === ownerKey ? viewState : initialOwnerViewState(ownerKey, deferRightReveal),
    { isRightOpen, isBottomOpen, bottomHides, isActive },
  );
  if (view !== viewState) setViewState(view);

  // The render already shows the result of the rules. The store takes it after the commit.
  useEffect(() => {
    if (!owner) return;
    if (nextBottomCheck !== bottomCheck) store.writeBottomCheck(owner, nextBottomCheck);
    // Only a decision of the shown view changes the state, so a kept view never saves its snapshot.
    if (nextBottomState !== panels.bottom) store.setBottomState(owner, nextBottomState);
  }, [bottomCheck, nextBottomCheck, nextBottomState, owner, panels.bottom, store]);

  const ownerRef = useRef(owner);
  const factsRef = useRef(facts);
  useLayoutEffect(() => {
    ownerRef.current = owner;
    factsRef.current = facts;
  });
  const updateView = useCallback((change: (state: OwnerViewState) => OwnerViewState): void => {
    const current = ownerRef.current;
    const currentKey = current ? sessionPanelOwnerKey(current) : null;
    setViewState((state) => (state.ownerKey === currentKey ? change(state) : state));
  }, []);
  /** Shows or hides a panel of the current owner, and saves its open state. */
  const setPanelOpen = useCallback(
    (panel: PanelId, isOpen: boolean, motion: PanelMotion): void => {
      const current = ownerRef.current;
      if (!current) return;
      updateView((state) => ({ ...state, motion: { ...state.motion, [panel]: motion } }));
      if (panel === "right") store.setRightOpen(current, isOpen);
      else store.setBottomState(current, bottomStateAfterChoice(isOpen, factsRef.current));
    },
    [store, updateView],
  );
  const setBottomOpen = useCallback(
    (value: boolean, motion: PanelMotion = "slide"): void => setPanelOpen("bottom", value, motion),
    [setPanelOpen],
  );
  const toggleRight = useCallback((): void => {
    const current = ownerRef.current;
    if (current) setPanelOpen("right", !isSavedRightOpen(store.readPanels(current)), "slide");
  }, [setPanelOpen, store]);
  const showRight = useCallback((): void => setPanelOpen("right", true, "slide"), [setPanelOpen]);
  const hideRightAtOnce = useCallback(
    (): void => setPanelOpen("right", false, "instant"),
    [setPanelOpen],
  );
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
    isBottomOpen,
    presence: view.presence,
    focusRequest: view.focusRequest,
    setBottomOpen,
    toggleRight,
    showRight,
    hideRightAtOnce,
    requestFocus,
    settleRight,
    settleBottom,
  };
}
