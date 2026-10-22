import type { BrowserDownload, BrowserDownloadState } from "@openducktor/contracts";
import { FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBrowserBytes } from "./browser-format";
import { BrowserProgressBar } from "./browser-progress-bar";

export type BrowserDownloadsMenuProps = {
  downloads: readonly BrowserDownload[];
  /** Shows the finished file in the OS file manager. */
  onReveal: (downloadId: string) => void;
};

const STATE_CLASS_NAMES = {
  in_progress: "text-muted-foreground",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  canceled: "text-muted-foreground",
} satisfies Record<BrowserDownloadState, string>;

/** The downloads of one browser tab, newest last, with progress and a file action. */
export function BrowserDownloadsMenu({
  downloads,
  onReveal,
}: BrowserDownloadsMenuProps): ReactElement {
  return (
    <section aria-label="Downloads" className="flex flex-col gap-1 p-1">
      <h2 className="px-2 pt-1 text-xs font-medium text-foreground">Downloads</h2>
      <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
        {downloads.map((download) => (
          <li
            key={download.downloadId}
            data-testid="browser-download"
            className="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
                title={download.fileName}
              >
                {download.fileName}
              </span>
              {download.state === "completed" ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label={`Show in folder: ${download.fileName}`}
                  onClick={() => onReveal(download.downloadId)}
                >
                  <FolderOpen className="size-3.5" aria-hidden="true" />
                  Show in folder
                </Button>
              ) : null}
            </div>
            {download.state === "in_progress" && download.totalBytes !== null ? (
              <BrowserProgressBar
                value={download.receivedBytes}
                total={download.totalBytes}
                label={`Download of ${download.fileName}`}
              />
            ) : null}
            <p className={cn("text-[11px] break-words", STATE_CLASS_NAMES[download.state])}>
              {downloadStatusText(download)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const downloadSizeText = (download: BrowserDownload): string => {
  const received = formatBrowserBytes(download.receivedBytes);
  if (download.totalBytes === null) return received;
  return `${received} of ${formatBrowserBytes(download.totalBytes)}`;
};

/** The state, size, and failure reason of a download. */
const downloadStatusText = (download: BrowserDownload): string => {
  switch (download.state) {
    case "in_progress":
      return `Downloading, ${downloadSizeText(download)}`;
    case "completed":
      return `Done, ${formatBrowserBytes(download.receivedBytes)}`;
    case "failed":
      return download.error ? `Failed: ${download.error}` : "Failed";
    case "canceled":
      return "Canceled";
  }
};
