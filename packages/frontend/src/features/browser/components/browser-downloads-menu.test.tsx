import { describe, expect, mock, test } from "bun:test";
import type { BrowserDownload } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserDownloadsMenu } from "./browser-downloads-menu";

const buildDownload = (overrides: Partial<BrowserDownload> = {}): BrowserDownload => ({
  downloadId: "download-1",
  url: "http://localhost:3000/report.pdf",
  fileName: "report.pdf",
  state: "completed",
  receivedBytes: 2_500_000,
  totalBytes: 2_500_000,
  error: null,
  ...overrides,
});

const downloads = (): BrowserDownload[] => [
  buildDownload({
    downloadId: "a",
    fileName: "data.csv",
    state: "in_progress",
    receivedBytes: 500_000,
    totalBytes: 2_000_000,
  }),
  buildDownload({ downloadId: "b", fileName: "report.pdf" }),
  buildDownload({
    downloadId: "c",
    fileName: "video.mp4",
    state: "failed",
    error: "Network error",
  }),
  buildDownload({ downloadId: "d", fileName: "notes.txt", state: "canceled" }),
];

describe("BrowserDownloadsMenu", () => {
  test("shows the name, progress, state, and failure reason of each download", () => {
    render(<BrowserDownloadsMenu downloads={downloads()} onReveal={() => {}} />);

    expect(screen.getAllByTestId("browser-download").map((item) => item.textContent)).toEqual([
      "data.csvDownloading, 500 KB of 2 MB",
      "report.pdfShow in folderDone, 2.5 MB",
      "video.mp4Failed: Network error",
      "notes.txtCanceled",
    ]);
    const progress = screen.getByRole("progressbar", { name: "Download of data.csv" });
    expect(progress.getAttribute("aria-valuenow")).toBe("25");
  });

  test("shows a finished file in its folder", () => {
    const onReveal = mock((_downloadId: string) => {});
    render(<BrowserDownloadsMenu downloads={downloads()} onReveal={onReveal} />);

    fireEvent.click(screen.getByRole("button", { name: "Show in folder: report.pdf" }));

    expect(onReveal).toHaveBeenCalledWith("b");
  });

  test("shows the received size when the total is not known", () => {
    render(
      <BrowserDownloadsMenu
        downloads={[
          buildDownload({ state: "in_progress", receivedBytes: 1_200, totalBytes: null }),
        ]}
        onReveal={() => {}}
      />,
    );

    expect(screen.getByTestId("browser-download").textContent).toBe(
      "report.pdfDownloading, 1.2 KB",
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
