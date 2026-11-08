// The draft of the composer of MobileComposer.tsx. A typed draft replaces the placeholder, opens
// Send, and shows the second send control while the agent works. A send empties the field.
import { must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import { typeText } from "../../motion/text";

/** The draft of the composer in `root`. Build time empties it. */
export function composerDraft(scene: Scene, root: HTMLElement) {
  const card = must(root, "[data-composer]");
  const typed = must(card, "[data-typed]");
  const clear = (): void => {
    typed.textContent = "";
    card.removeAttribute("data-draft");
  };
  clear();

  /** Types `text` from `at`. Returns the end of the typing. */
  const type = (text: string, at: number): number => {
    scene.at(at, () => card.toggleAttribute("data-draft", true));
    return typeText(scene, typed, text, at, { charsPerSecond: 22 });
  };

  /** Empties the field at `at`, as a send does. */
  const send = (at: number): void => scene.at(at, clear);

  return { type, send };
}
