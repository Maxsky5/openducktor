// The parts of BrowserSession.tsx that the browser and annotate scenes change: the tabs and the
// views of the panel, and the phone stage, where the panel and the chat take turns.
import { all, must } from "../../motion/dom";
import { selectTab } from "../studio/side-panels";

/** The panel of a browser session and its steps. */
export type SessionPanel = {
  strip: HTMLElement;
  tab: (id: string) => HTMLElement;
  back: HTMLElement;
  /** A phone stage shows one panel at a time, with Back to workspace. */
  narrow: boolean;
  /** Selects tab `id`, and shows its view. */
  select: (id: string) => void;
  /** Fades the start of the strip when its tabs overflow it. */
  fit: () => void;
  /** The phone stage shows the panel or the chat. */
  show: (part: "panel" | "chat") => void;
};

/** The panel of the session window `root`. */
export function sessionPanel(root: HTMLElement): SessionPanel {
  const strip = must(root, '[data-strip="right"]');
  const body = must(root, "[data-panel-body]");
  const tab = (id: string): HTMLElement => must(strip, `[data-ptab="${id}"]`);
  const back = must(strip, "[data-back]");
  const narrow = getComputedStyle(back).display !== "none";

  const select = (id: string): void => selectTab(strip, body, id);

  /**
   * The scroll area of session-panel.tsx scrolls to the selected tab at the end, so tabs that do
   * not fit hide at the start, and the start edge fades.
   */
  const fit = (): void => {
    const shown = all(strip, ":scope > *").filter((item) => item.offsetWidth > 0);
    const first = shown.at(0);
    const last = shown.at(-1);
    if (!first || !last) throw new Error("The panel strip shows no tab.");
    const used = last.offsetLeft + last.offsetWidth - first.offsetLeft;
    strip.toggleAttribute("data-fade-start", used > strip.clientWidth);
  };

  const show = (part: "panel" | "chat"): void => {
    root.dataset.shows = part;
  };

  return { strip, tab, back, narrow, select, fit, show };
}
