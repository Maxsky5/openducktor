import { withSlash } from "./slash";

type SectionListener = (id: string) => void;

const listeners = new Set<SectionListener>();

/**
 * Calls `listener` with the id of each section that `openSection` opens, so a component can show
 * the section, such as an accordion that opens its item. Returns the function that stops it.
 */
export function onOpenSection(listener: SectionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The section id of an address hash such as `#diagnostics`, or `null` when the hash is empty or is
 * not valid percent-encoding, such as `#%`.
 */
export function sectionId(hash: string): string | null {
  try {
    return decodeURIComponent(hash.replace(/^#/, "")) || null;
  } catch {
    return null;
  }
}

/**
 * Opens the section of `href` when `href` is on the current page: the section, or the page title
 * when `href` has no hash, gets focus without a scroll jump, and each `onOpenSection` listener
 * gets the id of the section.
 *
 * Call it after each change of the address. The browser sends `hashchange` only when it changes the
 * hash itself, for example for a plain `<a href="#id">` link, and `RouteFocus` then calls it. The
 * client router changes the address with `history.pushState`, which sends no event, so a control
 * that opens a section with the router, such as a search result, calls it itself.
 */
export function openSection(href: string): void {
  const url = new URL(href, window.location.href);
  if (withSlash(url.pathname) !== withSlash(window.location.pathname)) return;
  const id = sectionId(url.hash);
  const section = id ? document.getElementById(id) : null;
  const target = section ?? document.getElementById("docs-title");
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  if (section && id) for (const listener of listeners) listener(id);
}
