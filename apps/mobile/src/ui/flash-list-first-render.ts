/**
 * The `overrideProps` of a FlashList that shows a first screen of rows. FlashList adds 2 rows in
 * each pass of its first render by default, and each pass is a render and a measure before the
 * screen shows. This batch renders the rows of the screen in one or two passes. FlashList renders
 * only the rows in view, so a larger batch renders no more rows.
 */
export const FLASH_LIST_FIRST_RENDER = { initialDrawBatchSize: 100 } as const;
