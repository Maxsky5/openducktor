import { POPOVER_EDGE } from "./popover-placement";

/** The width of one menu column. */
export const MENU_COLUMN_WIDTH = 248;
/** The height of a menu item at the default text size. */
export const MENU_ITEM_HEIGHT = 46;
/** The padding of the menu card around its content. */
export const MENU_CARD_PADDING = 6;
/** The most columns of a menu that is taller than the window, as on a phone in landscape. */
const MAX_COLUMNS = 3;
/** The navigation bar above a menu that opens from its header button. */
const HEADER_ALLOWANCE = 72;

/**
 * The columns of a menu. A menu that is taller than the window, as on a phone in landscape, puts
 * its items in columns side by side, so all of them show without a scroll. A window that is too
 * narrow keeps one column, which scrolls.
 */
export const menuColumnCount = ({
  itemsHeight,
  headingHeight,
  window,
}: {
  itemsHeight: number;
  headingHeight: number;
  /** The window without its safe areas. */
  window: { width: number; height: number };
}): number => {
  const columnRoom =
    window.height - 2 * POPOVER_EDGE - HEADER_ALLOWANCE - headingHeight - 2 * MENU_CARD_PADDING;
  const fitting = Math.floor((window.width - 2 * POPOVER_EDGE) / MENU_COLUMN_WIDTH);
  const needed = Math.ceil(itemsHeight / Math.max(columnRoom, MENU_ITEM_HEIGHT));
  return Math.max(1, Math.min(needed, fitting, MAX_COLUMNS));
};

/** Splits the items into columns from top to bottom, then left to right, in their order. */
export const splitMenuColumns = <T>(items: readonly T[], columns: number): T[][] => {
  const perColumn = Math.ceil(items.length / columns);
  return Array.from({ length: columns }, (_, index) =>
    items.slice(index * perColumn, (index + 1) * perColumn),
  ).filter((column) => column.length > 0);
};
