import { all, must } from "../../motion/dom";
import { fadeIn, growIn, pop, shrinkOut } from "../../motion/effects";
import { mountLoop } from "../../motion/loop";
import { typeText } from "../../motion/text";
import { pointer } from "../../replica/shell/pointer";
import { ADDED_LINE, unsupported } from "../../sample/prompts";

/**
 * The visitor overrides the built-in QA prompt for every repository. The visitor turns on the
 * override and adds a line with a placeholder key that OpenDucktor does not know. The dialog shows
 * the error in the card, the role tab, the section list, and the footer, and Save stops. The
 * visitor types the correct key and saves. The markup holds the frame of the error.
 */
export function mountPrompts(): void {
  mountLoop(must(document, '[data-scene="prompts"]'), (scene) => {
    const root = must(scene.stage, "[data-prompts]");
    const toggle = must(root, "[data-switch]");
    const inherited = must(root, "[data-inherited]");
    const editor = must(root, "[data-textarea]");
    const caret = must(editor, "[data-caret]");
    const part = (name: string): HTMLElement => must(editor, `[data-part="${name}"]`);
    const lead = part("lead");
    const key = part("key");
    const close = part("close");
    const tail = part("tail");
    const error = must(root, "[data-error]");
    const banner = must(root, "[data-banner]");
    const alerts = all(root, "[data-alert]", SVGElement);
    const message = must(root, "[data-message]");
    const clear = must(root, "[data-clear]");
    const cancel = must(root, "[data-cancel]");
    const save = must(root, "[data-save]");
    const cursor = pointer(scene, root);

    // A textarea scrolls when the caret goes below its last visible row.
    const keepCaretInView = (): void => {
      const padding = Number.parseFloat(getComputedStyle(editor).paddingBottom);
      const bottom = caret.offsetTop + caret.offsetHeight + padding;
      if (bottom > editor.scrollTop + editor.clientHeight)
        editor.scrollTop = bottom - editor.clientHeight;
    };
    /** Types into the editor. `change` gets each new text. Returns the end time. */
    const write = (
      element: HTMLElement,
      value: string,
      at: number,
      charsPerSecond = 24,
      change?: (text: string) => void,
    ): number => {
      scene.at(at, () => editor.toggleAttribute("data-typing", true));
      const end = typeText(scene, element, value, at, {
        charsPerSecond,
        onText: (text) => {
          change?.(text);
          keepCaretInView();
        },
      });
      scene.at(end, () => editor.removeAttribute("data-typing"));
      return end;
    };
    const invalid = (): void => {
      root.dataset.invalid = "";
      error.hidden = false;
      scene.run(growIn(error, 0.3));
      banner.hidden = false;
      scene.run(growIn(banner, 0.35));
      for (const alert of alerts) scene.run(pop(alert, 1.35));
      scene.run(fadeIn(message, 0.25));
    };
    const valid = (): void => {
      delete root.dataset.invalid;
      scene.run(shrinkOut(error, 0.3));
      scene.run(shrinkOut(banner, 0.35));
    };

    // Start: no override. The editor shows the built-in prompt, and Save is ready.
    delete root.dataset.invalid;
    toggle.removeAttribute("data-checked");
    inherited.hidden = false;
    clear.toggleAttribute("data-disabled", true);
    error.hidden = true;
    banner.hidden = true;

    // The override starts from the built-in prompt, so the inherited prompt row goes away.
    const enabled = cursor.click(() => toggle, 0.5);
    scene.at(enabled, () => {
      toggle.toggleAttribute("data-checked", true);
      clear.removeAttribute("data-disabled");
      scene.run(shrinkOut(inherited));
    });

    // The new line goes after "Review:". The key "type" is not a placeholder of OpenDucktor.
    const focused = cursor.click(() => caret, enabled + 0.7, 0.8);
    scene.at(focused, () => editor.toggleAttribute("data-focus", true));
    const typed = write(lead, ADDED_LINE.lead, focused + 0.4);
    const keyed = write(key, ADDED_LINE.wrongKey, typed);
    const closed = write(close, ADDED_LINE.close, keyed);
    scene.at(closed, invalid);
    const finished = write(tail, ADDED_LINE.tail, closed + 0.15, 30);

    // A double click selects the key. The error follows each new key until the key is correct.
    const selected = cursor.click(() => key, finished + 0.6, 0.8);
    cursor.click(() => key, selected + 0.14, 0.04);
    scene.at(selected + 0.18, () => {
      key.toggleAttribute("data-selected", true);
      editor.toggleAttribute("data-selecting", true);
    });
    const retyped = selected + 0.8;
    scene.at(retyped, () => {
      key.removeAttribute("data-selected");
      editor.removeAttribute("data-selecting");
      key.after(caret);
    });
    const fixed = write(key, ADDED_LINE.key, retyped, 20, (next) => {
      if (next === ADDED_LINE.key) valid();
      else if (next) error.textContent = unsupported(next);
    });

    // The dialog closes when the save ends. The loop fades out at that moment.
    const saved = cursor.click(() => save, fixed + 0.7);
    scene.at(saved, () => {
      editor.removeAttribute("data-focus");
      save.textContent = "Saving...";
      save.toggleAttribute("data-disabled", true);
      cancel.toggleAttribute("data-disabled", true);
    });
    cursor.hide(saved + 0.5);
    scene.endAt(saved + 1.1);
  });
}
