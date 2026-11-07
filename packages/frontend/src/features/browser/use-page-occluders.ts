import { useSyncExternalStore } from "react";

/** One open host overlay, in viewport pixels. */
export type PageOccluderBox = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

/** A page box in the same pixels as `PageOccluderBox`. */
type PageBox = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

const OCCLUDER_SELECTOR = "[data-page-occluder]";
export const NO_PAGE_OCCLUDERS: readonly PageOccluderBox[] = [];

let occluders: readonly PageOccluderBox[] = NO_PAGE_OCCLUDERS;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let frame = 0;

const boxOf = (element: Element): PageOccluderBox => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
};

const sameBoxes = (a: readonly PageOccluderBox[], b: readonly PageOccluderBox[]): boolean =>
  a.length === b.length &&
  a.every((box, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      box.left === other.left &&
      box.top === other.top &&
      box.right === other.right &&
      box.bottom === other.bottom
    );
  });

/**
 * Reads the open overlays that a user can see. A hidden browser surface keeps its portals
 * mounted, and a portal that inherits `visibility: hidden` still has a box that would cover the
 * page of another tab. It runs only when an overlay appears, leaves, or moves.
 */
const refreshOccluders = (): void => {
  const next = Array.from(document.querySelectorAll(OCCLUDER_SELECTOR))
    .filter((element) => element.checkVisibility({ visibilityProperty: true }))
    .map(boxOf);
  if (sameBoxes(occluders, next)) {
    startTicking();
    return;
  }
  occluders = next;
  startTicking();
  for (const listener of listeners) listener();
};

/**
 * Reads the overlays again, such as when a browser surface that holds one shows or hides. A
 * surface that becomes visible again must let its overlay cover its page.
 */
export const refreshPageOccluders = (): void => {
  if (listeners.size === 0) return;
  refreshOccluders();
};

/** Re-measures an open overlay every frame, because animations, scroll, and resize move it. */
const tickOccluders = (): void => {
  frame = 0;
  refreshOccluders();
};

const startTicking = (): void => {
  if (frame === 0 && occluders.length > 0) {
    frame = requestAnimationFrame(tickOccluders);
  }
};

const containsOccluder = (node: Node): boolean =>
  node instanceof Element &&
  (node.matches(OCCLUDER_SELECTOR) || node.querySelector(OCCLUDER_SELECTOR) !== null);

/**
 * Most document changes cannot open or close an overlay. A chat that streams text, for example,
 * must not rescan the document. Only a matching attribute or a subtree that holds an overlay
 * does.
 */
const onMutations = (records: readonly MutationRecord[]): void => {
  for (const record of records) {
    if (record.type === "attributes") {
      refreshOccluders();
      return;
    }
    for (const node of record.addedNodes) {
      if (!containsOccluder(node)) continue;
      refreshOccluders();
      return;
    }
    for (const node of record.removedNodes) {
      if (!containsOccluder(node)) continue;
      refreshOccluders();
      return;
    }
  }
};

const startObserving = (): void => {
  if (observer !== null) return;
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-page-occluder"],
  });
  refreshOccluders();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  startObserving();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }
  };
};

/** True when an overlay covers some part of the page box, so the page must give it its place. */
export const pageIsOccluded = (
  openOccluders: readonly PageOccluderBox[],
  page: PageBox,
): boolean => {
  const right = page.left + page.width;
  const bottom = page.top + page.height;
  return openOccluders.some(
    (box) => box.left < right && page.left < box.right && box.top < bottom && page.top < box.bottom,
  );
};

/** The open host overlays. A native page view shows only where no overlay covers it. */
export const usePageOccluders = (): readonly PageOccluderBox[] =>
  useSyncExternalStore(
    subscribe,
    () => occluders,
    () => NO_PAGE_OCCLUDERS,
  );
