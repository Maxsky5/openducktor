"use client";
import { useEffect } from "react";
import { openSection } from "@/lib/focus";
import { withSlash } from "@/lib/slash";

/** The path of the page that shows, or null before the first page shows. */
let shownPath: string | null = null;
/** The page that Back or Forward opens. It keeps the focus and the scroll that the router restores. */
let traversalPath: string | null = null;

/**
 * Listens for Back and Forward, and for the hash changes of plain section links, which give their
 * section to `openSection`. Render it once, in the layout.
 */
export function RouteFocus() {
  useEffect(() => {
    const onTraversal = () => {
      traversalPath = withSlash(window.location.pathname);
    };
    const onHashChange = () => openSection(window.location.href);
    window.addEventListener("popstate", onTraversal);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onTraversal);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
  return null;
}

/**
 * After a new page opens, moves focus to its title, or to the section of the address, so keyboard
 * and screen reader users start reading there. The page renders it, so it runs when the content of
 * the new page is in the document, not when the address changes. The first page of a visit and a
 * page that Back or Forward opens keep the focus that the browser gives them.
 */
export function PageFocus({ path }: { path: string }) {
  useEffect(() => {
    const page = withSlash(path);
    const first = shownPath === null;
    if (shownPath === page) return;
    shownPath = page;
    const traversed = traversalPath === page;
    traversalPath = null;
    if (first || traversed) return;
    openSection(window.location.href);
  }, [path]);
  return null;
}
