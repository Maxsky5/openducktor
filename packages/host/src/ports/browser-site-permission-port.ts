import {
  browserPermissionDecisionSchema,
  browserPermissionKindSchema,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import { z } from "zod";
import type { HostOperationErrorAggregate } from "../effect/host-errors";

/** `<config-root>/browser/workspaces/<workspaceId>/site-permissions.json` */
export const browserSitePermissionFileSchema = z.strictObject({
  version: z.literal(1),
  sites: z.record(
    z.string().min(1),
    z.partialRecord(browserPermissionKindSchema, browserPermissionDecisionSchema),
  ),
});
export type BrowserSitePermissionFile = z.infer<typeof browserSitePermissionFileSchema>;

export type BrowserSitePermissionPort = {
  /** Returns an empty file when the workspace has no saved choices. */
  read(workspaceId: string): Effect.Effect<BrowserSitePermissionFile, HostOperationErrorAggregate>;
  write(
    workspaceId: string,
    file: BrowserSitePermissionFile,
  ): Effect.Effect<void, HostOperationErrorAggregate>;
  remove(workspaceId: string): Effect.Effect<void, HostOperationErrorAggregate>;
};
