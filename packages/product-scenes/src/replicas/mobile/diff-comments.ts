// The Inline Diff Comment flow of DiffScreen.tsx, as diff-comment-flow.tsx moves it: a tap selects
// a line, a tap on another line extends the range, Comment opens the comment field, and the save
// adds the pending comment under the last line of the range. The labels come from
// selectionLabel of diff-comment-model.ts and lineRangeLabel of diff-comment-view.tsx.
import { must } from "../../motion/dom";
import { fadeIn, growIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { typeText } from "../../motion/text";

/** The selected new lines, as the selection bar names them. */
export function selectionLabel(start: number, end: number): string {
  return start === end ? `Line ${start}, new lines` : `Lines ${start} to ${end}, new lines`;
}

/** The lines of a pending comment on new lines, as its card names them. */
export function commentRangeLabel(start: number, end: number): string {
  return start === end ? `Line ${start}, new` : `Lines ${start}-${end}, new`;
}

/** The comment flow of the diff screen `screen`. Build time clears it. */
export function diffComments(scene: Scene, screen: HTMLElement) {
  const line = (number: number): HTMLElement => must(screen, `[data-diff-line="${number}"]`);
  const bar = must(screen, "[data-selection-bar]");
  const label = must(bar, "[data-selection-label]");
  const composer = must(screen, "[data-comment-composer]");
  const field = must(composer, "[data-comment-field]");
  const typed = must(composer, "[data-comment-typed]");
  const card = must(screen, "[data-diff-comment]");
  let first = 0;
  let last = 0;

  const mark = (): void => {
    for (const element of screen.querySelectorAll<HTMLElement>("[data-diff-line]")) {
      const number = Number(element.dataset.diffLine);
      element.toggleAttribute("data-selected", number >= first && number <= last && first > 0);
    }
    label.textContent = selectionLabel(first, last);
  };
  bar.hidden = true;
  composer.hidden = true;
  card.hidden = true;
  typed.textContent = "";
  field.removeAttribute("data-can-save");

  /** Selects the line `number` at `at`. The selection bar fades in. */
  const select = (number: number, at: number): void =>
    scene.at(at, () => {
      first = number;
      last = number;
      mark();
      bar.hidden = false;
      scene.run(fadeIn(bar, 0.2));
    });

  /** Extends the selection to the line `number` at `at`. */
  const extend = (number: number, at: number): void =>
    scene.at(at, () => {
      first = Math.min(first, number);
      last = Math.max(last, number);
      mark();
    });

  /** Comment replaces the selection bar with the comment field at `at`. */
  const start = (at: number): void =>
    scene.at(at, () => {
      bar.hidden = true;
      must(composer, "[data-composer-title]").textContent =
        `Comment on ${selectionLabel(first, last).toLowerCase()}`;
      composer.hidden = false;
    });

  /** Types the comment from `at`. Returns the end of the typing. */
  const type = (text: string, at: number): number => {
    scene.at(at, () => field.toggleAttribute("data-can-save", true));
    return typeText(scene, typed, text, at, { charsPerSecond: 22 });
  };

  /** Saves the comment at `at`: the field closes, and the card grows under the last line. */
  const save = (at: number): void =>
    scene.at(at, () => {
      composer.hidden = true;
      first = 0;
      last = 0;
      mark();
      card.hidden = false;
      scene.run(growIn(card, 0.35));
    });

  return { line, select, extend, start, type, save };
}
