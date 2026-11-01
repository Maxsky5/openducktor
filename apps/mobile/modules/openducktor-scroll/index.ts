import { requireNativeModule } from "expo";

type ScrollModule = { redrawOnScroll(viewTag: number): Promise<void> };

/**
 * Android only: the scroll view with this view tag redraws in the frame of each scroll. See the
 * README. iOS has no such module, so the call reads it only when it runs.
 */
export const redrawOnScroll = (viewTag: number): Promise<void> =>
  requireNativeModule<ScrollModule>("OpenDucktorScroll").redrawOnScroll(viewTag);
