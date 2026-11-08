// The session panels of session-panel-split.tsx: the bottom panel and the right panel. Each panel
// has a tab strip, and each tab shows its view. A panel slides open from its outer edge.
import { all, data } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/**
 * Seconds that a session panel takes to open. session-panel-split.css moves a panel in
 * --sheet-open-dur of sheet.css, 300 ms, with a strong ease out.
 */
export const PANEL_OPEN = 0.3;

/** A session panel: its box, its content, and its separator. */
export type SidePanel = { panel: HTMLElement; content: HTMLElement; handle: HTMLElement };

/** Selects tab `id` of `strip`, and shows its view, the `[data-tab-view]` child of `body`. */
export function selectTab(strip: HTMLElement, body: HTMLElement, id: string): void {
  for (const item of all(strip, "[data-ptab]"))
    item.toggleAttribute("data-active", data(item, "ptab") === id);
  for (const view of all(body, ":scope > [data-tab-view]"))
    view.hidden = data(view, "tabView") !== id;
}

/**
 * Opens a session panel at the playhead. The panel grows from the outer edge, and the chat gives
 * it room. Its content keeps its open size at that edge, as session-panel-split.css keeps it, so
 * the content slides in and does not reflow.
 */
export function slideOpen(
  scene: Scene,
  { panel, content, handle }: SidePanel,
  size: "width" | "height",
): void {
  panel.hidden = false;
  handle.hidden = false;
  const open = panel.getBoundingClientRect()[size];
  gsap.set(content, { [size]: open });
  scene.run(
    gsap.fromTo(
      panel,
      { flexBasis: 0 },
      {
        flexBasis: open,
        duration: PANEL_OPEN,
        ease: EASE.arrive,
        clearProps: "flexBasis",
        onComplete: () => {
          gsap.set(content, { clearProps: size });
        },
      },
    ),
  );
}
