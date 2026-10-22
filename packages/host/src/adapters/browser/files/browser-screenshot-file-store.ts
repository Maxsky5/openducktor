import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { toHostOperationError } from "../../../effect/host-errors";
import type { BrowserScreenshotStorePort } from "../../../ports/browser-screenshot-store-port";

/** The number of screenshots that each workspace keeps. A new one deletes the oldest. */
export const BROWSER_SCREENSHOTS_KEPT = 200;

export const createBrowserScreenshotFileStore = (input: {
  configRoot: string;
}): BrowserScreenshotStorePort => {
  const folderFor = (workspaceId: string) =>
    path.join(input.configRoot, "browser", "screenshots", workspaceId);
  // Orders the screenshots of one millisecond.
  let sequence = 0;

  return {
    save: (workspaceId, png) =>
      Effect.tryPromise({
        try: async () => {
          const folder = folderFor(workspaceId);
          await mkdir(folder, { recursive: true });
          // The time comes first, so the names sort from the oldest to the newest.
          sequence += 1;
          const time = new Date().toISOString().replaceAll(":", "-");
          const name = `${time}-${String(sequence).padStart(9, "0")}-${randomUUID()}.png`;
          const file = path.join(folder, name);
          await writeFile(file, png, { mode: 0o600 });
          const names = (await readdir(folder)).filter((entry) => entry.endsWith(".png")).sort();
          await Promise.all(
            names
              .slice(0, -BROWSER_SCREENSHOTS_KEPT)
              .map((entry) => rm(path.join(folder, entry), { force: true })),
          );
          return pathToFileURL(file).href;
        },
        catch: (cause) => toHostOperationError(cause, "browser.screenshots.save", { workspaceId }),
      }),
    removeWorkspace: (workspaceId) =>
      Effect.tryPromise({
        try: () => rm(folderFor(workspaceId), { recursive: true, force: true }),
        catch: (cause) =>
          toHostOperationError(cause, "browser.screenshots.remove", { workspaceId }),
      }),
  };
};
