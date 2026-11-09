import { useCallback, useLayoutEffect, useRef, type RefCallback, type RefObject } from "react";

const portalOwners = new Map<
  HTMLElement,
  { owner: RefObject<HTMLElement | null>; dismiss(): void }
>();

/** A portalled menu keeps the exact local view that opened it as its shortcut owner. */
export function useShortcutPortalOwner(
  owner: RefObject<HTMLElement | null>,
  onInvoke: () => void,
): RefCallback<HTMLDivElement> {
  const latest = useRef(onInvoke);
  useLayoutEffect(() => {
    latest.current = onInvoke;
  });
  return useCallback(
    (portal) => {
      if (!portal) return;
      portalOwners.set(portal, { owner, dismiss: () => latest.current() });
      return () => {
        portalOwners.delete(portal);
      };
    },
    [owner],
  );
}

export const shortcutFocusWithin = (root: HTMLElement, focus: Element | null): boolean => {
  if (root.contains(focus)) return true;
  for (const [portal, { owner }] of portalOwners) {
    const anchor = owner.current;
    if (anchor?.isConnected && root.contains(anchor) && portal.contains(focus)) return true;
  }
  return false;
};

export const dismissShortcutPortal = (focus: Element | null): void => {
  for (const [portal, entry] of portalOwners) {
    if (portal.contains(focus)) {
      entry.dismiss();
      return;
    }
  }
};
