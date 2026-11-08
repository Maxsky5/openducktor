// A menu of ComposerMenu.tsx, as agent-chat-composer-menu.tsx shows it: it opens at once above the
// draft, a typed query filters its rows, and the active row and its place move with the arrow keys.
import { all, must } from "../../motion/dom";

/** The steps of a composer menu. */
export type ComposerMenuSteps = {
  /** Makes the row at `index` of the shown rows active. */
  activate: (index: number) => void;
  /** Shows the rows whose option contains `query`, as filterSlashCommands does. */
  filter: (query: string) => void;
  open: () => void;
  close: () => void;
};

/** The menu named `name` in `root`. The first row is active when it opens. */
export function composerMenu(root: HTMLElement, name: string): ComposerMenuSteps {
  const menu = must(root, `[data-menu="${name}"]`);
  const count = must(menu, "[data-menu-count]");
  const rows = all(menu, "[data-option]");
  const shown = (): HTMLElement[] => rows.filter((row) => !row.hidden);

  const activate = (index: number): void => {
    const visible = shown();
    for (const [place, row] of visible.entries())
      row.toggleAttribute("data-active", place === index);
    count.textContent = `${index + 1} / ${visible.length}`;
  };

  const filter = (query: string): void => {
    for (const row of rows) row.hidden = !(row.dataset.option ?? "").includes(query);
    activate(0);
  };

  return {
    activate,
    filter,
    open: () => {
      menu.toggleAttribute("data-open", true);
    },
    close: () => {
      menu.removeAttribute("data-open");
    },
  };
}
