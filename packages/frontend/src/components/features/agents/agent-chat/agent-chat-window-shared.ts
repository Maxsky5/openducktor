export const CHAT_SCROLL_EDGE_THRESHOLD_PX = 48;
export const CHAT_TURN_REVEAL_EDGE_THRESHOLD_PX = 200;

/** The transcript rows that the row window mounts, in row window order. */
export const readMountedRows = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-row-key]"));
