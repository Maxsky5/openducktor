import { isBrowserNavigableUrl } from "@openducktor/contracts";
import { openExternalUrl } from "./open-external-url";

/** Where a link opens: the default browser of the system, or a browser tab of OpenDucktor. */
export type LinkOpenChoice = "system" | "app";

/** The browser tabs of the page that shows, which can open a link in a new tab. */
export type InAppLinkTarget = {
  /** Why no tab can open now, such as the tab limit, or null when one can. */
  blockedReason: string | null;
  open(url: string): Promise<void>;
};

/** The element or point that the link menu shows next to, in viewport pixels. */
export type LinkMenuAnchor = { x: number; y: number; width: number; height: number };

export type LinkMenuRequest = { url: string; anchor: LinkMenuAnchor };

export type LinkClick = Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** The keyboard of this device, which can differ from the host in the web runner. */
export const usesMacKeys = (): boolean => /Mac|iPhone|iPad/u.test(globalThis.navigator.platform);

/** The key cap label of the modifier that a click needs: ⌘ on macOS, Ctrl elsewhere. */
export const linkModifierLabel = (): string => (usesMacKeys() ? "⌘" : "Ctrl");

/** Mod+Click opens the system browser, and Shift+Mod+Click a browser tab. Other clicks ask. */
export const linkOpenChoiceForClick = (click: LinkClick): LinkOpenChoice | null => {
  const mod = usesMacKeys() ? click.metaKey && !click.ctrlKey : click.ctrlKey && !click.metaKey;
  if (!mod || click.altKey) return null;
  return click.shiftKey ? "app" : "system";
};

const targets: InAppLinkTarget[] = [];
let menu: LinkMenuRequest | null = null;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of Array.from(listeners)) listener();
};

export const subscribeLinkOpen = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The browser tabs that open links now: the page that registered last. */
export const inAppLinkTarget = (): InAppLinkTarget | null => targets[targets.length - 1] ?? null;

/** Lets the page that shows open links in its browser tabs, until the returned call. */
export const registerInAppLinkTarget = (target: InAppLinkTarget): (() => void) => {
  targets.push(target);
  notify();
  return () => {
    const index = targets.lastIndexOf(target);
    if (index >= 0) targets.splice(index, 1);
    notify();
  };
};

export const linkMenuRequest = (): LinkMenuRequest | null => menu;

export const closeLinkMenu = (): void => {
  if (menu === null) return;
  menu = null;
  notify();
};

/** Opens a link in the chosen browser. A browser tab fails with the reason when none can open. */
export const openLink = async (url: string, choice: LinkOpenChoice): Promise<void> => {
  closeLinkMenu();
  if (choice === "system") {
    await openExternalUrl(url);
    return;
  }
  const target = inAppLinkTarget();
  if (target === null) {
    throw new Error("Open a task or chat page to open links in a browser tab.");
  }
  if (target.blockedReason !== null) throw new Error(target.blockedReason);
  await target.open(url);
};

/**
 * Opens a clicked link. A modifier click chooses the browser at once. A plain click shows the link
 * menu, or opens the system browser when no page can open browser tabs or the link is not a web
 * page, such as a `mailto:` link.
 */
export const openClickedLink = async (
  url: string,
  click: LinkClick,
  anchor: LinkMenuAnchor,
): Promise<void> => {
  const choice = linkOpenChoiceForClick(click);
  if (choice !== null) {
    await openLink(url, choice);
    return;
  }
  if (inAppLinkTarget() === null || !isBrowserNavigableUrl(url)) {
    await openLink(url, "system");
    return;
  }
  menu = { url, anchor };
  notify();
};
