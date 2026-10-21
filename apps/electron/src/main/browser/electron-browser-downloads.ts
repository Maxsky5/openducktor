import path from "node:path";
import type { BrowserDownload } from "@openducktor/contracts";

/** The Electron `DownloadItem` API that the browser engine uses. */
export type ElectronDownloadItem = {
  getFilename(): string;
  getURL(): string;
  getReceivedBytes(): number;
  getTotalBytes(): number;
  setSavePath(savePath: string): void;
  on(
    event: "updated",
    listener: (event: { preventDefault(): void }, state: "progressing" | "interrupted") => void,
  ): void;
  once(
    event: "done",
    listener: (
      event: { preventDefault(): void },
      state: "completed" | "cancelled" | "interrupted",
    ) => void,
  ): void;
};

const DEFAULT_FILE_NAME = "download";
export const BROWSER_DOWNLOAD_FAILED_MESSAGE =
  "The download stopped before it finished. Check the connection and the free disk space, then try again.";

/**
 * A free path in the directory for a file name. A taken name gets a number, as in
 * `report (1).pdf`.
 */
export const uniqueDownloadPath = (
  directory: string,
  suggestedName: string,
  isTaken: (candidate: string) => boolean,
): string => {
  const fileName = path.basename(suggestedName).trim() || DEFAULT_FILE_NAME;
  const extension = path.extname(fileName);
  const stem = extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
  let candidate = path.join(directory, fileName);
  for (let index = 1; isTaken(candidate); index += 1) {
    candidate = path.join(directory, `${stem} (${index})${extension}`);
  }
  return candidate;
};

export type BrowserDownloadsInput = {
  directory(): string;
  fileExists(filePath: string): boolean;
  newId(): string;
  report(tabId: string, download: BrowserDownload): void;
};

/**
 * Saves each download of a tab in the Downloads folder and reports its progress. The paths stay
 * known until the tab closes, so Show in folder works for each entry.
 */
export const createBrowserDownloads = (input: BrowserDownloadsInput) => {
  const pathsByTab = new Map<string, Map<string, string>>();
  const reservedPaths = new Set<string>();

  const start = (tabId: string, item: ElectronDownloadItem): void => {
    const savePath = uniqueDownloadPath(
      input.directory(),
      item.getFilename(),
      (candidate) => reservedPaths.has(candidate) || input.fileExists(candidate),
    );
    reservedPaths.add(savePath);
    item.setSavePath(savePath);
    const downloadId = input.newId();
    let tabPaths = pathsByTab.get(tabId);
    if (!tabPaths) {
      tabPaths = new Map();
      pathsByTab.set(tabId, tabPaths);
    }
    tabPaths.set(downloadId, savePath);

    const report = (state: BrowserDownload["state"], error: string | null): void => {
      const totalBytes = item.getTotalBytes();
      input.report(tabId, {
        downloadId,
        url: item.getURL(),
        fileName: path.basename(savePath),
        state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: totalBytes > 0 ? totalBytes : null,
        error,
      });
    };

    item.on("updated", () => report("in_progress", null));
    item.once("done", (_event, state) => {
      reservedPaths.delete(savePath);
      if (state === "completed") {
        report("completed", null);
      } else if (state === "cancelled") {
        report("canceled", null);
      } else {
        report("failed", BROWSER_DOWNLOAD_FAILED_MESSAGE);
      }
    });
    report("in_progress", null);
  };

  return {
    start,
    /** The saved file of a download, or `null` when the tab has no such download. */
    path: (tabId: string, downloadId: string): string | null =>
      pathsByTab.get(tabId)?.get(downloadId) ?? null,
    forgetTab: (tabId: string): void => {
      pathsByTab.delete(tabId);
    },
  };
};

export type BrowserDownloads = ReturnType<typeof createBrowserDownloads>;
