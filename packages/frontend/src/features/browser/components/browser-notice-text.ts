import type { BrowserNotice } from "@openducktor/contracts";
import { browserSiteLabel } from "./browser-format";

export type BrowserNoticeText = {
  /** `warning` for a refused action, `info` for a page notification. */
  tone: "warning" | "info";
  title: string;
  description: string;
};

/** Plain text for a browser notice, for an in-app toast. */
export const browserNoticeText = (notice: BrowserNotice): BrowserNoticeText => {
  switch (notice.kind) {
    case "scheme_refused":
      return {
        tone: "warning",
        title: `The tab did not open a ${notice.scheme}: address`,
        description: "Browser tabs open only http and https pages.",
      };
    case "popup_limit":
      return {
        tone: "warning",
        title: "The page could not open a new tab",
        description: `A task or session can have ${notice.limit} browser tabs. Close a tab, then try again.`,
      };
    case "page_notification": {
      const site = browserSiteLabel(notice.origin);
      const body = notice.body.trim();
      return {
        tone: "info",
        title: notice.title.trim() || `Notification from ${site}`,
        description: body ? `${site}: ${body}` : site,
      };
    }
  }
};
