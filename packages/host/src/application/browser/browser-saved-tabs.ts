import { type BrowserTabSummary, isBrowserNavigableUrl } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSerialGate } from "../../effect/serial-gate";
import type { BrowserSavedTab, BrowserTabStorePort } from "../../ports/browser-tab-store-port";
import { BrowserServiceError } from "./browser-service-error";
import type { BrowserTabRegistry } from "./browser-tab-registry";

/**
 * Keeps the saved tab file in step with the registry. Each change of a saved field writes the
 * whole list. Writes run one at a time, and a write that waits writes the newest list.
 */
export const createBrowserSavedTabs = (input: {
  store: BrowserTabStorePort;
  registry: BrowserTabRegistry;
  runJob(job: Effect.Effect<void>): void;
  /** A write failed after the last write that worked. */
  onSaveFailed(message: string): void;
}) => {
  const saved = new Map<string, BrowserSavedTab>();
  const gate = createSerialGate();
  let version = 0;
  let writtenVersion = 0;
  let failing = false;

  const writeLatest = gate.run(
    "tabs",
    Effect.suspend(() => {
      if (writtenVersion === version) return Effect.void;
      const target = version;
      return input.store.write({ version: 1, tabs: Array.from(saved.values()) }).pipe(
        Effect.match({
          onSuccess: () => {
            writtenVersion = target;
            failing = false;
          },
          onFailure: (cause) => {
            if (!failing) {
              input.onSaveFailed(
                `OpenDucktor could not save the browser tabs in ${input.store.path}: ${cause.message} The tabs work, but they do not come back after a restart.`,
              );
            }
            failing = true;
          },
        }),
      );
    }),
  );

  const changed = (): void => {
    version += 1;
    input.runJob(writeLatest);
  };

  input.registry.subscribe((event) => {
    if (event.type === "tab_upserted") {
      const previous = saved.get(event.tab.tabId);
      const next = toSavedTab(event.tab, previous);
      if (previous && sameSavedTab(previous, next)) return;
      saved.set(next.tabId, next);
      changed();
      return;
    }
    if (event.type === "tab_closed" && saved.delete(event.tabId)) changed();
  });

  return {
    /**
     * Reads the saved tabs of the last run. Call it once, before the tabs go into the registry, so
     * that adding them does not write the file again.
     */
    read: input.store.read().pipe(
      Effect.map((file) => {
        for (const tab of file.tabs) saved.set(tab.tabId, tab);
        return file.tabs;
      }),
      Effect.mapError(
        (cause) =>
          new BrowserServiceError({
            code: "browser_action_failed",
            operation: "browser.tabs.load",
            message: `OpenDucktor could not read the saved browser tabs in ${input.store.path}: ${cause.message} Fix or delete the file, then restart OpenDucktor.`,
            cause,
          }),
      ),
    ),
    /** Waits for the running write, then writes the newest list when it changed. */
    flush: writeLatest,
  };
};

/**
 * The saved fields of a tab. `about:blank`, error pages, and other schemes cannot load after a
 * restart, so they keep the last saved URL.
 */
const toSavedTab = (summary: BrowserTabSummary, previous: BrowserSavedTab | undefined) => ({
  tabId: summary.tabId,
  owner: summary.owner,
  url: isBrowserNavigableUrl(summary.url) ? summary.url : (previous?.url ?? ""),
  title: summary.title,
  createdBy: summary.createdBy,
  shared: summary.shared,
});

const sameSavedTab = (left: BrowserSavedTab, right: BrowserSavedTab): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
