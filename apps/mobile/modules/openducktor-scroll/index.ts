import { requireNativeModule } from "expo";

type ScrollModule = { redrawOnScroll(viewTag: number): void };

/**
 * Android only: the scroll view with this view tag redraws in the frame of each scroll, so a
 * scroll that keeps content in place after a layout change shows with that change. A view that is
 * not mounted yet gets the redraw after its mount. iOS has no such module, so the call reads it
 * only when it runs.
 */
export const redrawOnScroll = (viewTag: number): void =>
  requireNativeModule<ScrollModule>("OpenDucktorScroll").redrawOnScroll(viewTag);
