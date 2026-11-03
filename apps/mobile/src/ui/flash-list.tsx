import type { FlashListProps, FlashListRef } from "@shopify/flash-list";
// oxlint-disable-next-line no-restricted-imports -- this wrapper is the one place that renders FlashList
import { FlashList as ShopifyFlashList } from "@shopify/flash-list";
import type { ReactElement, Ref } from "react";

/**
 * The rows that the first render of a list adds in each pass. FlashList adds 2 rows in each pass
 * by default, and each pass is a render and a measure before the screen shows. This batch renders
 * the rows of the screen in one or two passes. FlashList renders only the rows in view, so a
 * larger batch renders no more rows.
 */
const FIRST_RENDER = { initialDrawBatchSize: 100 } as const;

/** The FlashList of the app. Each list renders its first screen of rows in one or two passes. */
export function FlashList<T>(
  props: FlashListProps<T> & { ref?: Ref<FlashListRef<T>> },
): ReactElement {
  return <ShopifyFlashList {...props} overrideProps={FIRST_RENDER} />;
}
