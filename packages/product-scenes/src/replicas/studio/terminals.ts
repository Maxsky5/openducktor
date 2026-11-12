// The bottom panel of BottomPanel.tsx: the terminal tabs of the repository actions that run,
// and their output. A run opens the panel, adds its tab at the end of the strip, and selects it.
import { all, must } from "../../motion/dom";
import { fadeIn, pop } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { selectTab, slideOpen } from "./side-panels";

/** The bottom panel of the session window `root`, and the steps that change it. */
export function bottomPanel(scene: Scene, root: HTMLElement) {
  const panel = must(root, "[data-bottom-panel]");
  const content = must(panel, "[data-bottom-content]");
  const handle = must(root, "[data-bottom-handle]");
  const strip = must(panel, '[data-strip="bottom"]');
  const toggle = must(root, '[data-toggle="bottom"]');
  const tab = (id: string): HTMLElement => must(strip, `[data-ptab="${id}"]`);
  const term = (id: string): HTMLElement => must(panel, `[data-term="${id}"]`);

  /** Build time: the panel and its separator are hidden, and no terminal runs. */
  const close = (): void => {
    panel.hidden = true;
    handle.hidden = true;
    toggle.setAttribute("aria-pressed", "false");
    for (const item of all(strip, "[data-ptab]")) item.hidden = true;
    for (const item of all(panel, "[data-term]")) item.hidden = true;
    for (const line of all(panel, "[data-term-line]")) line.hidden = true;
  };

  /** Opens the panel at `at`. It slides up from the bottom edge of the window. */
  const open = (at: number): void =>
    scene.at(at, () => {
      toggle.setAttribute("aria-pressed", "true");
      slideOpen(scene, { panel, content, handle }, "height");
    });

  /** Action `id` runs at `at`: its new terminal tab shows at the end of the strip and opens. */
  const run = (id: string, at: number): void =>
    scene.at(at, () => {
      const item = tab(id);
      item.hidden = false;
      selectTab(strip, content, id);
      scene.run(pop(item, 1.1));
      scene.run(fadeIn(term(id), 0.2));
    });

  /** Shows the output lines of terminal `id`, one at each time of `times`. */
  const print = (id: string, times: readonly number[]): void => {
    all(term(id), "[data-term-line]").forEach((line, index) => {
      const at = times[index];
      if (at === undefined)
        throw new Error(`The ${id} terminal has no time for line ${index + 1}.`);
      scene.at(at, () => {
        line.hidden = false;
      });
    });
  };

  return { close, open, run, print };
}
