import type { BrowserTabOwner } from "@openducktor/contracts";
import { HostBrowserClientError } from "@openducktor/host-client";
import type { BrowserTabsStore } from "@openducktor/frontend-core/browser/browser-tabs-store";

export type BrowserTabOpenInput = {
  owner: BrowserTabOwner;
  tabId: string;
  /** The first page of the tab, or null for a blank tab. */
  address: string | null;
};

export type BrowserTabRequestPorts = {
  /** False when new tabs get no host page, so opening them needs no ready engine. */
  hostPage: boolean;
  open(request: BrowserTabOpenInput): Promise<void>;
  start(tabId: string): Promise<void>;
  close(tabId: string): Promise<void>;
};

type TabQueue = { tail: Promise<void>; canceled: boolean };

/**
 * Open, start, and close requests of browser tabs. Open and start wait until the engine is ready,
 * for example until the user installs the browser. Requests of one tab run in order, and a close
 * cancels an open or start that still waits.
 */
export const createBrowserTabRequests = (
  store: BrowserTabsStore,
  ports: BrowserTabRequestPorts,
) => {
  const queues = new Map<string, TabQueue>();

  const engineReady = (): Promise<void> =>
    new Promise((resolve) => {
      const check = (): boolean => {
        if (store.getSnapshot().engine?.kind !== "ready") return false;
        resolve();
        return true;
      };
      if (check()) return;
      const unsubscribe = store.subscribe(() => {
        if (check()) unsubscribe();
      });
    });

  const queueOf = (tabId: string): TabQueue => {
    let queue = queues.get(tabId);
    if (!queue) {
      queue = { tail: Promise.resolve(), canceled: false };
      queues.set(tabId, queue);
    }
    return queue;
  };

  const enqueue = (tabId: string, run: (queue: TabQueue) => Promise<void>): Promise<void> => {
    const queue = queueOf(tabId);
    const next = queue.tail.then(() => run(queue));
    queue.tail = next.catch(() => undefined);
    return next;
  };

  const whenReady =
    (operation: () => Promise<void>) =>
    async (queue: TabQueue): Promise<void> => {
      await engineReady();
      if (queue.canceled) return;
      await operation();
    };

  return {
    open: (request: BrowserTabOpenInput) =>
      enqueue(
        request.tabId,
        ports.hostPage
          ? whenReady(() => ports.open(request))
          : async (queue) => {
              if (!queue.canceled) await ports.open(request);
            },
      ),
    start: (tabId: string) =>
      enqueue(
        tabId,
        whenReady(() => ports.start(tabId)),
      ),
    close(tabId: string): Promise<void> {
      queueOf(tabId).canceled = true;
      return enqueue(tabId, async () => {
        try {
          await ports.close(tabId);
        } catch (cause) {
          // The tab is already gone, so the close reached its goal.
          if (cause instanceof HostBrowserClientError && cause.code === "browser_tab_not_found") {
            return;
          }
          throw cause;
        } finally {
          queues.delete(tabId);
        }
      });
    },
  };
};

export type BrowserTabRequests = ReturnType<typeof createBrowserTabRequests>;
