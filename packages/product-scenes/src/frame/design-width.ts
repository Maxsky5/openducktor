// The design width of a product window, for a host option that widens or narrows the window.
import type { CSSProperties } from "react";

/** The style that sets the design width of a window, or no style when `width` is undefined. */
export function designWidthStyle(width: number | undefined): CSSProperties | undefined {
  if (width === undefined) return undefined;
  const style: CSSProperties & { "--design-width": number } = { "--design-width": width };
  return style;
}
