import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import path from "node:path";
import type { BrowserDownload } from "@openducktor/contracts";
import {
  BROWSER_DOWNLOAD_FAILED_MESSAGE,
  createBrowserDownloads,
  uniqueDownloadPath,
} from "./electron-browser-downloads";

class FakeDownloadItem extends EventEmitter {
  savePath = "";
  received = 0;

  constructor(
    private readonly fileName: string,
    private readonly total: number,
  ) {
    super();
  }

  getFilename(): string {
    return this.fileName;
  }

  getURL(): string {
    return `https://example.com/${this.fileName}`;
  }

  getReceivedBytes(): number {
    return this.received;
  }

  getTotalBytes(): number {
    return this.total;
  }

  setSavePath(savePath: string): void {
    this.savePath = savePath;
  }

  progress(received: number): void {
    this.received = received;
    this.emit("updated", { preventDefault() {} }, "progressing");
  }

  finish(state: "completed" | "cancelled" | "interrupted"): void {
    this.emit("done", { preventDefault() {} }, state);
  }
}

const DIRECTORY = path.join(path.sep, "downloads");

describe("uniqueDownloadPath", () => {
  test("numbers a taken name before its extension", () => {
    const taken = new Set([
      path.join(DIRECTORY, "report.pdf"),
      path.join(DIRECTORY, "report (1).pdf"),
    ]);
    expect(uniqueDownloadPath(DIRECTORY, "report.pdf", (candidate) => taken.has(candidate))).toBe(
      path.join(DIRECTORY, "report (2).pdf"),
    );
  });

  test("keeps the file inside the directory and names an empty file", () => {
    expect(uniqueDownloadPath(DIRECTORY, "../../etc/passwd", () => false)).toBe(
      path.join(DIRECTORY, "passwd"),
    );
    expect(uniqueDownloadPath(DIRECTORY, "  ", () => false)).toBe(path.join(DIRECTORY, "download"));
  });
});

describe("createBrowserDownloads", () => {
  const setup = () => {
    const reports: Array<{ tabId: string; download: BrowserDownload }> = [];
    let nextId = 1;
    const downloads = createBrowserDownloads({
      directory: () => DIRECTORY,
      fileExists: () => false,
      newId: () => `download-${nextId++}`,
      report: (tabId, download) => reports.push({ tabId, download }),
    });
    return { downloads, reports };
  };

  test("saves in the downloads folder and reports progress and completion", () => {
    const { downloads, reports } = setup();
    const item = new FakeDownloadItem("data.csv", 100);
    downloads.start("tab-1", item);
    item.progress(40);
    item.finish("completed");

    expect(item.savePath).toBe(path.join(DIRECTORY, "data.csv"));
    expect(reports.map(({ download }) => [download.state, download.receivedBytes])).toEqual([
      ["in_progress", 0],
      ["in_progress", 40],
      ["completed", 40],
    ]);
    expect(reports[0]).toEqual({
      tabId: "tab-1",
      download: {
        downloadId: "download-1",
        url: "https://example.com/data.csv",
        fileName: "data.csv",
        state: "in_progress",
        receivedBytes: 0,
        totalBytes: 100,
        error: null,
      },
    });
    expect(downloads.path("tab-1", "download-1")).toBe(path.join(DIRECTORY, "data.csv"));
  });

  test("gives two running downloads of one name two files", () => {
    const { downloads } = setup();
    const first = new FakeDownloadItem("data.csv", 0);
    const second = new FakeDownloadItem("data.csv", 0);
    downloads.start("tab-1", first);
    downloads.start("tab-1", second);
    expect(second.savePath).toBe(path.join(DIRECTORY, "data (1).csv"));
  });

  test("reports cancel and failure, and forgets the downloads of a closed tab", () => {
    const { downloads, reports } = setup();
    const canceled = new FakeDownloadItem("a.zip", 0);
    const failed = new FakeDownloadItem("b.zip", 0);
    downloads.start("tab-1", canceled);
    downloads.start("tab-1", failed);
    canceled.finish("cancelled");
    failed.finish("interrupted");

    const final = reports.slice(-2).map(({ download }) => [download.state, download.error]);
    expect(final).toEqual([
      ["canceled", null],
      ["failed", BROWSER_DOWNLOAD_FAILED_MESSAGE],
    ]);
    expect(reports[0]?.download.totalBytes).toBeNull();
    downloads.forgetTab("tab-1");
    expect(downloads.path("tab-1", "download-1")).toBeNull();
  });
});
