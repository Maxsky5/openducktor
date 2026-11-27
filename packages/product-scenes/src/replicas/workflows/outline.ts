// The controller of OutlinePanel.tsx: the rows of the states and the transitions, the selected
// row, the problem markers, and the counts of the sections.
import { all, must } from "../../motion/dom";
import { growIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import type { OutlineSectionId } from "./text";

export function outlinePanel(scene: Scene, root: HTMLElement) {
  const outline = must(root, ".wfe-outline");
  /** The row of element `key`, such as `state:test` or `event:move_to_test`. */
  const row = (key: string): HTMLElement => must(outline, `[data-outline-row="${key}"]`);
  const count = (section: OutlineSectionId): HTMLElement =>
    must(outline, `[data-outline-section="${section}"] [data-count]`);

  const setCount = (section: OutlineSectionId, value: number): void => {
    const badge = count(section);
    badge.textContent = String(value);
    badge.hidden = value === 0;
  };

  /** Marks the row of `key` as the selection, or no row. */
  const select = (key: string | null): void => {
    for (const item of all(outline, "[data-outline-row]"))
      item.toggleAttribute("data-current", item.dataset.outlineRow === key);
  };

  const setProblem = (key: string, shown: boolean): void => {
    must(row(key), "[data-row-problem]").hidden = !shown;
  };

  /** A transition row shows its route once something triggers it, else No trigger yet. */
  const setTriggered = (key: string, triggered: boolean): void => {
    must(row(key), "[data-route]").hidden = !triggered;
    must(row(key), "[data-no-trigger]").hidden = triggered;
  };

  /** The row of a new element comes in at `at` and pushes the rows under it down. */
  const add = (key: string, at: number): void =>
    scene.at(at, () => {
      const item = row(key);
      item.hidden = false;
      scene.run(growIn(item, 0.25));
    });

  /**
   * The first frame: the rows of the elements that the user adds `later` do not show yet, and a
   * transition that the user draws has no trigger yet. Each section shows its count of `counts`,
   * and no row is selected.
   */
  const reset = (
    later: readonly string[],
    counts: Readonly<Partial<Record<OutlineSectionId, number>>>,
  ): void => {
    for (const key of later) {
      row(key).hidden = true;
      if (key.startsWith("event:")) setTriggered(key, false);
    }
    // SAFETY: the keys of `counts` are section ids, as its type gives them.
    for (const [section, value] of Object.entries(counts) as [OutlineSectionId, number][])
      setCount(section, value);
    select(null);
  };

  return { reset, setCount, select, setProblem, setTriggered, add };
}
