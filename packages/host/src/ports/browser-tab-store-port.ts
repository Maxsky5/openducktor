import {
  browserTabCreatorSchema,
  browserTabIdSchema,
  browserTabOwnerSchema,
  browserUrlSchema,
  isBrowserNavigableUrl,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import { z } from "zod";
import type { HostOperationErrorAggregate } from "../effect/host-errors";

/** One saved tab. After a restart, it comes back as a tab that has not started. */
const browserSavedTabSchema = z.strictObject({
  tabId: browserTabIdSchema,
  owner: browserTabOwnerSchema,
  /** The http or https URL of the last top-level page, or empty when the tab loaded no page. */
  url: z.union([z.literal(""), browserUrlSchema.refine(isBrowserNavigableUrl)]),
  title: z.string().nullable(),
  createdBy: browserTabCreatorSchema,
  shared: z.boolean(),
});
export type BrowserSavedTab = z.infer<typeof browserSavedTabSchema>;

/** `<config-root>/browser/<engine-kind>-tabs.json`. The tabs are in the order that they opened. */
export const browserSavedTabsFileSchema = z.strictObject({
  version: z.literal(1),
  tabs: z.array(browserSavedTabSchema),
});
export type BrowserSavedTabsFile = z.infer<typeof browserSavedTabsFileSchema>;

export type BrowserTabStorePort = {
  /** The file path, so an error can tell the user which file to fix. */
  readonly path: string;
  /** Returns an empty file when no tabs are saved. */
  read(): Effect.Effect<BrowserSavedTabsFile, HostOperationErrorAggregate>;
  write(file: BrowserSavedTabsFile): Effect.Effect<void, HostOperationErrorAggregate>;
};
