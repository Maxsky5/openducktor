import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserEngineKind } from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import { hasNestedNodeErrorCode, toHostOperationError } from "../../../effect/host-errors";
import {
  type BrowserSitePermissionFile,
  type BrowserSitePermissionPort,
  browserSitePermissionFileSchema,
} from "../../../ports/browser-site-permission-port";
import {
  type BrowserSavedTabsFile,
  type BrowserTabStorePort,
  browserSavedTabsFileSchema,
} from "../../../ports/browser-tab-store-port";

const readJsonFile = <Schema extends z.ZodType>(
  file: string,
  schema: Schema,
  empty: z.output<Schema>,
  operation: string,
  details: Record<string, string>,
) =>
  Effect.tryPromise({
    try: async (): Promise<z.output<Schema>> => {
      try {
        return schema.parse(JSON.parse(await readFile(file, "utf8")));
      } catch (cause) {
        if (hasNestedNodeErrorCode(cause, "ENOENT")) {
          return empty;
        }
        throw cause;
      }
    },
    catch: (cause) => toHostOperationError(cause, operation, details),
  });

/** Writes a temporary file, then renames it, so a reader never sees half a file. */
const writeJsonFile = (
  file: string,
  value: BrowserSitePermissionFile | BrowserSavedTabsFile,
  operation: string,
  details: Record<string, string>,
) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, file);
    },
    catch: (cause) => toHostOperationError(cause, operation, details),
  });

const EMPTY_SITE_PERMISSIONS: BrowserSitePermissionFile = { version: 1, sites: {} };

/** Keeps the saved site permission choices of each workspace with its browser data. */
export const createBrowserSitePermissionFileStore = (input: {
  configRoot: string;
}): BrowserSitePermissionPort => {
  const fileFor = (workspaceId: string) =>
    path.join(input.configRoot, "browser", "workspaces", workspaceId, "site-permissions.json");

  return {
    read: (workspaceId) =>
      readJsonFile(
        fileFor(workspaceId),
        browserSitePermissionFileSchema,
        EMPTY_SITE_PERMISSIONS,
        "browser.sitePermissions.read",
        { workspaceId },
      ),
    write: (workspaceId, file) =>
      writeJsonFile(fileFor(workspaceId), file, "browser.sitePermissions.write", { workspaceId }),
    remove: (workspaceId) =>
      Effect.tryPromise({
        try: () => rm(fileFor(workspaceId), { force: true }),
        catch: (cause) =>
          toHostOperationError(cause, "browser.sitePermissions.remove", { workspaceId }),
      }),
  };
};

const EMPTY_TABS: BrowserSavedTabsFile = { version: 1, tabs: [] };

/**
 * Keeps the tabs of one engine kind. The Electron app and the web runner can share a config root,
 * and each one keeps its own tabs.
 */
export const createBrowserTabFileStore = (input: {
  configRoot: string;
  engineKind: BrowserEngineKind;
}): BrowserTabStorePort => {
  const file = path.join(input.configRoot, "browser", `${input.engineKind}-tabs.json`);
  return {
    path: file,
    read: () =>
      readJsonFile(file, browserSavedTabsFileSchema, EMPTY_TABS, "browser.tabs.read", { file }),
    write: (tabs) => writeJsonFile(file, tabs, "browser.tabs.write", { file }),
  };
};
