// The Keyboard shortcuts section of ShortcutSettings.tsx. The search keeps the rows that match
// after each letter, as groupCommandViews of settings-shortcut-model.ts filters them. The recorder
// of a row listens, shows the modifiers that are down, and puts the keys into the draft. The save
// disables the section.
import { all, data, must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import { typeText } from "../../motion/text";
import type { KeyPlatform } from "../keys";
import { heldText, ROW_TEXT } from "./ShortcutRow";
import type { SearchStep } from "./ShortcutSettings";

/** The row of a command, with the parts of its recorder. */
type Recorder = {
  row: HTMLElement;
  field: HTMLElement;
  add: HTMLElement;
  press: HTMLElement;
  keycaps: HTMLElement;
  badge: HTMLElement;
  when: HTMLElement;
  hint: HTMLElement;
  cancel: HTMLElement;
  actions: HTMLElement;
};

/** The parts of the section, and the steps that change it. */
type ShortcutSettingsSteps = {
  platform: () => KeyPlatform;
  reset: (id: string) => void;
  focusSearch: (at: number) => void;
  type: (term: string, at: number, charsPerSecond: number) => number;
  hover: (id: string, at: number) => void;
  leave: (id: string, at: number) => void;
  record: (id: string, at: number) => void;
  hold: (id: string, modifiers: readonly string[], at: number) => void;
  assign: (id: string, at: number) => void;
  disable: (at: number) => void;
  search: () => HTMLElement;
  keyField: (id: string) => HTMLElement;
};

/** The section in `root`, the search steps of the scene, and the steps that change them. */
export function shortcutSettings(
  scene: Scene,
  root: HTMLElement,
  steps: readonly SearchStep[],
): ShortcutSettingsSteps {
  const section = must(root, "[data-shortcut-settings]");
  const search = must(section, "[data-shortcut-search]");
  const typed = must(search, "[data-typed]");
  const filter = must(section, "[data-shortcut-filter]");
  const resetAll = must(section, "[data-reset-all]");

  /** The row of the command `id` that the scene records, with the parts of its recorder. */
  const recorderOf = (id: string): Recorder => {
    const row = must(section, `[data-command="${id}"]`);
    return {
      row,
      field: must(row, "[data-key-field]"),
      add: must(row, "[data-add-keys]"),
      press: must(row, "[data-press]"),
      keycaps: must(row, "[data-keycaps]"),
      badge: must(row, "[data-custom]"),
      when: must(row, "[data-when]"),
      hint: must(row, "[data-recording-hint]"),
      cancel: must(row, "[data-record-cancel]"),
      actions: must(row, "[data-row-actions]"),
    };
  };

  /** The search shows `text`, and the list keeps the rows of its step and their groups. */
  const showSearch = (text: string): void => {
    const step = steps.find((candidate) => candidate.term === text);
    if (!step) throw new Error(`The scene has no rows for the search "${text}".`);
    search.toggleAttribute("data-filled", text !== "");
    filter.toggleAttribute("data-disabled", text !== "");
    for (const row of all(section, "[data-command]"))
      row.hidden = !step.commands.includes(data(row, "command"));
    for (const group of all(section, "[data-shortcut-group]"))
      group.hidden = all(group, "[data-command]").every((row) => row.hidden);
  };

  /** The search loses the focus and its caret. */
  const blurSearch = (): void => {
    search.removeAttribute("data-focused");
    typed.removeAttribute("data-typing");
  };

  /**
   * Build time: the search is empty, and the draft has no change, so the row of `id` has no keys.
   * The markup holds the frame after the recording.
   */
  const reset = (id: string): void => {
    typed.textContent = "";
    showSearch("");
    resetAll.hidden = true;
    const parts = recorderOf(id);
    for (const part of [parts.keycaps, parts.badge]) part.hidden = true;
    parts.add.hidden = false;
  };

  /** The visitor selects the search at `at`: it takes the focus and shows its caret. */
  const focusSearch = (at: number): void =>
    scene.at(at, () => {
      search.toggleAttribute("data-focused", true);
      typed.toggleAttribute("data-typing", true);
    });

  /**
   * Types `term` in the search from `at`. After each letter, the list keeps the rows of the step
   * of that text. Returns the end time.
   */
  const type = (term: string, at: number, charsPerSecond: number): number =>
    typeText(scene, typed, term, at, { charsPerSecond, onText: showSearch });

  /** The pointer rests on the key field of the row `id` from `at`. */
  const hover = (id: string, at: number): void =>
    scene.at(at, () => {
      const { row, field } = recorderOf(id);
      for (const element of [row, field]) element.toggleAttribute("data-hover", true);
    });

  /** The pointer leaves the row `id` at `at`. */
  const leave = (id: string, at: number): void =>
    scene.at(at, () => {
      const { row, field } = recorderOf(id);
      for (const element of [row, field]) element.removeAttribute("data-hover");
    });

  /**
   * The visitor selects Add keys of the row `id` at `at`. The search loses the focus, and the row
   * records: the field listens with Press keys…, the hint replaces the When line, and Cancel shows.
   */
  const record = (id: string, at: number): void =>
    scene.at(at, () => {
      blurSearch();
      const parts = recorderOf(id);
      parts.row.toggleAttribute("data-recording", true);
      parts.press.textContent = ROW_TEXT.pressKeys;
      for (const shown of [parts.press, parts.hint, parts.cancel]) shown.hidden = false;
      for (const hidden of [parts.add, parts.when]) hidden.hidden = true;
    });

  /** From `at`, the modifiers `modifiers` are down, and the field of the row `id` shows them. */
  const hold = (id: string, modifiers: readonly string[], at: number): void =>
    scene.at(at, () => {
      recorderOf(id).press.textContent = heldText(modifiers);
    });

  /**
   * The recorded keys go into the draft at `at`. The row stops recording and shows the keys with
   * the Custom badge, and Reset all shows. The key field keeps the focus, so Remove shows.
   */
  const assign = (id: string, at: number): void =>
    scene.at(at, () => {
      const parts = recorderOf(id);
      parts.row.removeAttribute("data-recording");
      for (const hidden of [parts.press, parts.hint, parts.cancel]) hidden.hidden = true;
      for (const shown of [parts.keycaps, parts.badge, parts.when, parts.actions, resetAll])
        shown.hidden = false;
    });

  /** The save disables the section from `at`: the key fields and Reset all dim. */
  const disable = (at: number): void =>
    scene.at(at, () => {
      for (const field of all(section, "[data-key-field]"))
        field.toggleAttribute("data-disabled", true);
      resetAll.toggleAttribute("data-disabled", true);
      for (const actions of all(section, "[data-row-actions]")) actions.hidden = true;
    });

  /** The platform whose keys the section shows. */
  const platform = (): KeyPlatform => {
    const value = data(section, "platform");
    if (value !== "mac" && value !== "pc") throw new Error(`The section has no platform ${value}.`);
    return value;
  };

  return {
    platform,
    reset,
    focusSearch,
    type,
    hover,
    leave,
    record,
    hold,
    assign,
    disable,
    search: (): HTMLElement => search,
    keyField: (id: string): HTMLElement => recorderOf(id).field,
  };
}
