import {
  BROWSER_TITLE_MAX_LENGTH,
  type BrowserTabSummary,
  browserUrlSchema,
  isBrowserNavigableUrl,
} from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { ClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import { toast } from "sonner";
import { z } from "zod";
import { perConnection } from "@/lib/per-connection";

const STORAGE_PREFIX = "openducktor:browser-recent-pages:v1:";
export const BROWSER_RECENT_PAGES_LIMIT = 8;
/** A larger favicon does not go to storage. The tile then shows the first letter of the site. */
const FAVICON_MAX_LENGTH = 8_192;

const recentPageSchema = z.object({
  url: browserUrlSchema.refine(isBrowserNavigableUrl),
  title: z.string().max(BROWSER_TITLE_MAX_LENGTH).nullable(),
  favicon: z.string().max(FAVICON_MAX_LENGTH).nullable(),
});
export type BrowserRecentPage = z.infer<typeof recentPageSchema>;

const recentPagesRecordSchema = z.object({
  version: z.literal(1),
  pages: z.array(recentPageSchema).max(BROWSER_RECENT_PAGES_LIMIT),
});

const EMPTY: readonly BrowserRecentPage[] = [];

/** The recent pages of each workspace of one host, newest first. */
export type BrowserRecentPages = {
  /** The recent pages of a workspace. The first read loads the saved list. */
  read(workspaceId: string): readonly BrowserRecentPage[];
  subscribe(listener: () => void): () => void;
  /**
   * Puts the page of a user tab first in the recent pages of its workspace, after the page loads.
   * The same URL keeps one entry with its newest title and icon.
   */
  record(tab: BrowserTabSummary): void;
  /** Forgets the recent pages of the workspaces that no longer exist. */
  prune(workspaceIds: ReadonlySet<string>): void;
};

/** The recent pages of the host of a client connection, saved in the storage of the connection. */
export const browserRecentPagesOf = perConnection(({ storage }) =>
  createBrowserRecentPages(storage),
);

export const useBrowserRecentPages = (): BrowserRecentPages =>
  browserRecentPagesOf(useClientConnection());

const storageKey = (workspaceId: string): string =>
  `${STORAGE_PREFIX}${encodeURIComponent(workspaceId)}`;

const createBrowserRecentPages = (storage: ClientStorage): BrowserRecentPages => {
  const pagesByWorkspace = new Map<string, readonly BrowserRecentPage[]>();
  const listeners = new Set<() => void>();
  let readErrorShown = false;
  let writeErrorShown = false;

  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };

  const load = (workspaceId: string): readonly BrowserRecentPage[] => {
    try {
      const saved = storage.getItem(storageKey(workspaceId));
      return saved === null ? EMPTY : recentPagesRecordSchema.parse(JSON.parse(saved)).pages;
    } catch (error) {
      console.error("[browser] Failed to read the recent pages.", { workspaceId, error });
      if (!readErrorShown) {
        readErrorShown = true;
        toast.error("Could not read the recent browser pages", {
          description: `${errorMessage(error)} The next page that you open starts a new list.`,
        });
      }
      return EMPTY;
    }
  };

  const read = (workspaceId: string): readonly BrowserRecentPage[] => {
    let pages = pagesByWorkspace.get(workspaceId);
    if (pages === undefined) {
      pages = load(workspaceId);
      pagesByWorkspace.set(workspaceId, pages);
    }
    return pages;
  };

  const save = (workspaceId: string, pages: readonly BrowserRecentPage[]): void => {
    pagesByWorkspace.set(workspaceId, pages);
    try {
      storage.setItem(storageKey(workspaceId), JSON.stringify({ version: 1, pages }));
    } catch (error) {
      console.error("[browser] Failed to save the recent pages.", { workspaceId, error });
      if (!writeErrorShown) {
        writeErrorShown = true;
        toast.error("Could not save the recent browser pages", {
          description: `${errorMessage(error)} The list works until the app restarts.`,
        });
      }
    }
    notify();
  };

  return {
    read,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    record: (tab) => {
      if (tab.createdBy !== "user" || tab.loading || tab.error !== null) return;
      if (!isBrowserNavigableUrl(tab.url)) return;
      const { workspaceId } = tab.owner;
      const page: BrowserRecentPage = {
        url: tab.url,
        title: tab.title,
        favicon:
          tab.favicon !== null && tab.favicon.length <= FAVICON_MAX_LENGTH ? tab.favicon : null,
      };
      const current = read(workspaceId);
      const first = current[0];
      if (first?.url === page.url && first.title === page.title && first.favicon === page.favicon) {
        return;
      }
      const others = current.filter((candidate) => candidate.url !== page.url);
      save(workspaceId, [page, ...others].slice(0, BROWSER_RECENT_PAGES_LIMIT));
    },
    prune: (workspaceIds) => {
      try {
        const staleKeys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
          const workspaceId = decodeURIComponent(key.slice(STORAGE_PREFIX.length));
          if (!workspaceIds.has(workspaceId)) staleKeys.push(key);
        }
        for (const key of staleKeys) storage.removeItem(key);
      } catch (error) {
        console.error("[browser] Failed to remove old recent pages.", { error });
        toast.error("Could not remove the recent browser pages of removed workspaces", {
          description: errorMessage(error),
        });
      }
      let removed = false;
      for (const workspaceId of pagesByWorkspace.keys()) {
        if (workspaceIds.has(workspaceId)) continue;
        pagesByWorkspace.delete(workspaceId);
        removed = true;
      }
      if (removed) notify();
    },
  };
};
