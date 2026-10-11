// The command palette of Palette.astro. It opens and closes at once, as the product does. The
// query filters the rows and marks them at each key, the highlight moves with the arrow keys, and
// the footer shows the hints of the highlighted row. A view replaces the list.
import { all, data, must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { matchesQuery, segments } from "./match";

/** The list or the form that the palette shows. */
type PaletteList = "home" | "search" | "target" | "waiting" | "reply";

const SEARCH_PLACEHOLDER = "Search actions, tasks, and chats…";
const ACTIONS_PLACEHOLDER = "Search task actions…";

/** Writes `text` into `element` with a mark on each part that `query` finds. */
function markText(element: HTMLElement, text: string, query: string): void {
  element.replaceChildren(
    ...segments(text, query).map((part) => {
      if (!part.marked) return document.createTextNode(part.text);
      const mark = document.createElement("mark");
      mark.textContent = part.text;
      return mark;
    }),
  );
}

/** The command palette in `root`, and the steps that change it. */
export function commandPalette(scene: Scene, root: HTMLElement) {
  const overlay = must(root, "[data-palette]");
  const box = must(overlay, "[data-pal]");
  const query = must(box, "[data-pal-query]");
  const placeholder = must(box, "[data-pal-placeholder]");
  const list = (view: PaletteList): HTMLElement => must(box, `[data-pal-list="${view}"]`);
  const hint = (name: string): HTMLElement => must(box, `[data-hint="${name}"]`);
  const label = (name: string): HTMLElement => must(hint(name), "[data-hint-label]");
  /** The view of the palette. The markup holds the search results. */
  let current: PaletteList = "search";
  /** The rows that the current list shows. */
  const rows = (): HTMLElement[] =>
    all(list(current), "[data-pal-row]").filter((row) => row.closest("[hidden]") === null);

  /** Highlights `row`, and the footer shows its hints. */
  const highlight = (row: HTMLElement | undefined): void => {
    for (const item of all(box, "[data-pal-row]"))
      item.toggleAttribute("data-selected", item === row);
    if (!row || current === "reply") return;
    label("enter").textContent = data(row, "enter");
    const { next, edit } = row.dataset;
    hint("next").hidden = next === undefined;
    if (next) label("next").textContent = next;
    hint("edit").hidden = edit === undefined;
    if (edit) label("edit").textContent = edit;
    hint("tab").hidden = !row.hasAttribute("data-tab");
  };

  const setView = (next: PaletteList): void => {
    current = next;
    box.dataset.view = next;
    const listsActions = next === "target" || next === "waiting";
    placeholder.textContent = listsActions ? ACTIONS_PLACEHOLDER : SEARCH_PLACEHOLDER;
    hint("enter").hidden = next === "reply";
    hint("workspace").hidden = next !== "home" && next !== "search";
    label("close").textContent = next === "home" || next === "search" ? "Close" : "Back";
    if (next === "reply") for (const name of ["next", "edit", "tab"]) hint(name).hidden = true;
    highlight(rows()[0]);
  };

  /** Filters the search results for `text`, marks them, and highlights the first one. */
  const search = (text: string): void => {
    if (!text) {
      setView("home");
      return;
    }
    const results = list("search");
    for (const holder of all(results, "[data-pal-text]")) {
      const texts = data(holder, "palText").split("\n");
      holder.hidden = !matchesQuery(texts, text);
      if (holder.hidden) continue;
      const [title = "", id] = texts;
      markText(must(holder, "[data-pal-title]"), title, text);
      if (id) markText(must(holder, "[data-pal-id]"), id, text);
    }
    for (const group of all(results, "[data-pal-group]")) {
      if (data(group, "palGroup") === "create") continue;
      group.hidden = all(group, "[data-pal-text]").every((holder) => holder.hidden);
    }
    must(results, "[data-pal-create]").textContent = text;
    setView("search");
  };

  /** Build time: the palette is closed, and its query is empty. */
  const reset = (): void => {
    overlay.hidden = true;
    query.textContent = "";
    query.removeAttribute("data-typing");
    setView("home");
  };

  /** Opens the palette at once on its home list, with the caret in the input. */
  const open = (at: number): void =>
    scene.at(at, () => {
      overlay.hidden = false;
      query.textContent = "";
      query.toggleAttribute("data-typing", true);
      setView("home");
    });

  /** Closes the palette at once. */
  const close = (at: number): void =>
    scene.at(at, () => {
      overlay.hidden = true;
      query.removeAttribute("data-typing");
    });

  /** Types `text` into the input. Each key filters the results. Returns the end time. */
  const type = (text: string, at: number, charsPerSecond = 9): number =>
    typeText(scene, query, text, at, { charsPerSecond, onText: search });

  /** The highlight moves to the next row of the list, as ArrowDown does. */
  const down = (at: number): void =>
    scene.at(at, () => {
      const shown = rows();
      const index = shown.findIndex((row) => row.hasAttribute("data-selected"));
      highlight(shown[(index + 1) % shown.length]);
    });

  /** Opens a view at once: the actions of a task, or a reply. The chip names the task. */
  const show = (next: PaletteList, at: number, chip?: string): void =>
    scene.at(at, () => {
      if (chip) must(box, "[data-pal-chip-title]").textContent = chip;
      query.textContent = "";
      setView(next);
    });

  return { reset, open, close, type, down, show };
}
