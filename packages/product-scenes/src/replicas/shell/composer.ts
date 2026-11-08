// The composer of agent-chat-composer.tsx. The task sessions and the chats share it. The draft
// follows the draft of the mobile composer in ../mobile/draft.ts.
import { must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { compactTokens, type ContextUse } from "../format";
import type { Activity } from "../vocabulary";

/** The activity of the composer in `root`: the running ray, or the waiting ring. */
export function composerActivity(root: HTMLElement) {
  const composer = must(root, "[data-composer]");
  return (activity: Activity): void => {
    composer.dataset.activity = activity;
  };
}

/** The context ring of the composer, in the format of agent-context-usage-indicator.tsx. */
export function contextMeter(meter: HTMLElement) {
  const tokens = must(meter, "[data-tokens]");
  return (use: ContextUse): void => {
    meter.style.setProperty("--used", `${Math.min(use.percent, 100)}`);
    tokens.textContent = compactTokens(use.tokens);
  };
}

/**
 * The draft of the composer in `root`: the editor with the typed text of ComposerDraft, and Send.
 * A draft hides the placeholder, and a draft with text to send turns Send on. A send empties the
 * draft. A scene that types more than one part, such as a query and then a chip, marks the draft
 * and Send itself; `type` does both.
 */
export function composerDraft(scene: Scene, root: HTMLElement) {
  const editor = must(root, "[data-editor]");
  const typed = must(editor, "[data-typed]");
  const button = must(root, "[data-send]");

  /** Shows the caret at `at`, as a click in the editor does. */
  const focus = (at: number): void =>
    scene.at(at, () => typed.toggleAttribute("data-typing", true));

  /** Hides the placeholder at `at`, as the first typed character does. */
  const draft = (at: number): void =>
    scene.at(at, () => editor.toggleAttribute("data-draft", true));

  /** Turns Send on at `at`, when the draft has text to send. */
  const ready = (at: number): void =>
    scene.at(at, () => button.toggleAttribute("data-ready", true));

  /** Types `text` from `at`. Returns the end of the typing. */
  const type = (text: string, at: number, charsPerSecond: number): number => {
    focus(at);
    draft(at);
    ready(at);
    return typeText(scene, typed, text, at, { charsPerSecond });
  };

  /** Empties the draft at `at`, as a send does. */
  const send = (at: number): void =>
    scene.at(at, () => {
      typed.removeAttribute("data-typing");
      typed.textContent = "";
      editor.removeAttribute("data-draft");
      button.removeAttribute("data-ready");
    });

  return { editor, typed, button, focus, draft, ready, type, send };
}
