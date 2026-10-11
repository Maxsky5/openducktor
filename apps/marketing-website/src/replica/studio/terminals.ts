// The bottom panel of BottomPanel.astro: the terminal tabs of the repository actions that run,
// and their output. A run opens the panel, adds its tab at the end of the strip, and selects it.
import { all, data, must } from "../../motion/dom";
import { fadeIn, pop } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";

/** The bottom panel of the session window `root`, and the steps that change it. */
export function bottomPanel(scene: Scene, root: HTMLElement) {
  const panel = must(root, "[data-bottom-panel]");
  const content = must(panel, "[data-bottom-content]");
  const strip = must(panel, '[data-strip="bottom"]');
  const toggle = must(root, '[data-toggle="bottom"]');
  const tab = (id: string): HTMLElement => must(strip, `[data-ptab="${id}"]`);
  const term = (id: string): HTMLElement => must(panel, `[data-term="${id}"]`);

  const select = (id: string): void => {
    for (const item of all(strip, "[data-ptab]"))
      item.toggleAttribute("data-active", data(item, "ptab") === id);
    for (const item of all(panel, "[data-term]")) item.hidden = data(item, "term") !== id;
  };

  /** Build time: the panel is hidden, and no terminal runs. */
  const close = (): void => {
    panel.hidden = true;
    toggle.setAttribute("aria-pressed", "false");
    for (const item of all(strip, "[data-ptab]")) item.hidden = true;
    for (const item of all(panel, "[data-term]")) item.hidden = true;
    for (const line of all(panel, "[data-term-line]")) line.hidden = true;
  };

  /**
   * Opens the panel at `at`. The panel grows over the bottom of the window, and its content keeps
   * its open height at the bottom edge, as session-panel-split.css does.
   */
  const open = (at: number): void =>
    scene.at(at, () => {
      panel.hidden = false;
      toggle.setAttribute("aria-pressed", "true");
      const height = panel.offsetHeight;
      gsap.set(content, { height });
      scene.run(
        gsap.fromTo(
          panel,
          { flexBasis: "0px" },
          {
            flexBasis: `${height}px`,
            duration: 0.45,
            ease: EASE.arrive,
            clearProps: "flexBasis",
            onComplete: () => {
              gsap.set(content, { clearProps: "height" });
            },
          },
        ),
      );
    });

  /** Action `id` runs at `at`: its new terminal tab shows at the end of the strip and opens. */
  const run = (id: string, at: number): void =>
    scene.at(at, () => {
      const item = tab(id);
      item.hidden = false;
      select(id);
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
