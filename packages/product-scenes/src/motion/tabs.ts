// The keyboard pattern of a tab list: the arrows wrap, and Home and End select the first and the
// last tab. One tab takes the tab stop.

/** The index of the tab that `key` selects from the tab at `index`, or undefined for other keys. */
export function targetIndex(key: string, index: number, last: number): number | undefined {
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return index === last ? 0 : index + 1;
    case "ArrowUp":
    case "ArrowLeft":
      return index === 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return undefined;
  }
}

/** The tabs before the current one show a full progress bar, so the tabs read as one timeline. */
export function tabState(index: number, current: number): "done" | "current" | "next" {
  if (index < current) return "done";
  if (index === current) return "current";
  return "next";
}
