/**
 * The link events of a Markdown view. Words writes plain anchors, so the view opens each link
 * itself: a local link with the caller action, an in-page link in place, and a web link through the
 * caller or the shell. A link never navigates the app window.
 */
import type { KeyboardEvent, MouseEvent } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { openClickedLink } from "@/lib/link-open";
import { useOpenExternalUrl } from "@/lib/open-external-url";
import { revealElement } from "@/lib/reveal-element";
import { LOCAL_LINK_ATTRIBUTE, type MarkdownLinks } from "./markdown-html";

type LinkEvent = MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>;

export type MarkdownLinkEvents = {
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onAuxClick: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
};

const showOpenFailure = (cause: unknown): void => {
  toast.error("Failed to open link", { description: errorMessage(cause) });
};

/** The link of the view that an event targets. */
export const closestLink = (event: LinkEvent): HTMLAnchorElement | null => {
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  return anchor && event.currentTarget.contains(anchor) ? anchor : null;
};

/**
 * Reveals the target of an in-page link, such as a footnote, without a route change. Words writes
 * the ids of footnotes as they appear in their links.
 */
const scrollToFragment = (href: string): void => {
  const target = document.getElementById(href.slice(1));
  if (target) revealElement(target);
};

export const useMarkdownLinkEvents = (links: MarkdownLinks | undefined): MarkdownLinkEvents => {
  const openExternalUrl = useOpenExternalUrl();
  const localLinks = links !== "text" ? (links?.local ?? null) : null;
  // A caller can open web links itself, such as the review links of a comment.
  const callerOpen = links !== "text" ? links?.open : undefined;

  const openLink = (anchor: HTMLAnchorElement, event: LinkEvent): void => {
    const destination = anchor.getAttribute(LOCAL_LINK_ATTRIBUTE);
    if (destination !== null) {
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (localLinks && !modified) localLinks.open(destination, anchor);
      return;
    }
    // Words keeps the text of a link whose destination is unsafe, without a destination.
    const href = anchor.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#")) {
      scrollToFragment(href);
      return;
    }
    if (callerOpen) {
      callerOpen(href);
      return;
    }
    const { x, y, width, height } = anchor.getBoundingClientRect();
    void openClickedLink(href, event, { x, y, width, height }, openExternalUrl).catch(
      showOpenFailure,
    );
  };

  return {
    onClick: (event) => {
      const anchor = closestLink(event);
      if (!anchor) return;
      event.preventDefault();
      if (event.button === 0) openLink(anchor, event);
    },
    // Enter opens the link once, also when the key repeats.
    onKeyDown: (event) => {
      if (event.key !== "Enter") return;
      const anchor = closestLink(event);
      if (!anchor) return;
      event.preventDefault();
      if (!event.repeat) openLink(anchor, event);
    },
    // A middle click opens a web link in the system browser. Other buttons do nothing.
    onAuxClick: (event) => {
      const anchor = closestLink(event);
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href");
      if (event.button !== 1 || !href || href.startsWith("#")) return;
      if (callerOpen) callerOpen(href);
      else void openExternalUrl(href).catch(showOpenFailure);
    },
    onContextMenu: (event) => {
      if (closestLink(event)) event.preventDefault();
    },
  };
};
