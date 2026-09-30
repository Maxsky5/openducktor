import { all, must, numberData } from "../../motion/dom";
import { mountOnce } from "../../motion/once";
import { typeText } from "../../motion/text";

/** Characters that the visitor types each second. */
const TYPING_SPEED = 44;

/** The terminal types while its top is above 80% of the screen height and its bottom below 20%. */
const TERMINAL_ZONE = { start: "top 80%", end: "bottom 20%" };

/**
 * The browser version terminal types its command once, when the visitor reaches it. Then the
 * web runner prints its start log, one line after the wait of that line. Text that is not shown
 * yet keeps its place, so the terminal keeps its final size. The copy button copies the full
 * command at any time. The desktop terminals do not move.
 */
export function mountWebRunner(): void {
  mountOnce(
    must(document, "[data-install]"),
    (scene) => {
      const input = must(scene.stage, "[data-input]");
      const typed = must(input, "[data-typed]");
      const rest = must(input, "[data-rest]");
      const output = all(scene.stage, "[data-wait]");
      const text = typed.textContent;
      typed.textContent = "";
      rest.textContent = text;
      rest.toggleAttribute("data-pending", true);
      input.toggleAttribute("data-typing", true);
      for (const line of output) line.toggleAttribute("data-pending", true);
      const done = typeText(scene, typed, text, 0.3, {
        charsPerSecond: TYPING_SPEED,
        onText: (shown) => {
          rest.textContent = text.slice(shown.length);
        },
      });
      scene.at(done + 0.3, () => input.removeAttribute("data-typing"));
      let next = done + 0.6;
      for (const line of output) {
        next += numberData(line, "wait");
        scene.at(next, () => line.removeAttribute("data-pending"));
      }
    },
    TERMINAL_ZONE,
  );
}
