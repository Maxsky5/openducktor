import {
  BROWSER_TITLE_MAX_LENGTH,
  type BrowserHostEvent,
  type BrowserPrompt,
  type BrowserTabOwner,
  type BrowserTabSummary,
  browserTabOwnerKey,
  limitBrowserUrl,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { BrowserServiceError } from "./browser-service-error";

export type BrowserTabRecord = {
  readonly tabId: string;
  readonly workspaceId: string;
  readonly ownerKey: string;
  summary: BrowserTabSummary;
};

export type BrowserTabRegistry = {
  get(tabId: string): BrowserTabRecord | undefined;
  require(tabId: string, operation: string): Effect.Effect<BrowserTabRecord, BrowserServiceError>;
  list(): BrowserTabSummary[];
  /** Tabs of the owner, in the order that they opened. */
  ownerTabs(owner: BrowserTabOwner): BrowserTabRecord[];
  workspaceTabs(workspaceId: string): BrowserTabRecord[];
  add(summary: BrowserTabSummary): BrowserTabRecord;
  /** Applies a change and publishes the tab when its summary changed. */
  update(tabId: string, change: (summary: BrowserTabSummary) => BrowserTabSummary): void;
  remove(tabId: string): void;
  publish(event: BrowserHostEvent): void;
  /** Local listener for every published event, such as a service that waits for a tab state. */
  subscribe(listener: (event: BrowserHostEvent) => void): () => void;
  /** Local listener for each tab change. `previous` is null for a new tab, `next` for a removed one. */
  onTabChange(listener: BrowserTabChangeListener): () => void;
};

export type BrowserTabChangeListener = (
  previous: BrowserTabSummary | null,
  next: BrowserTabSummary | null,
) => void;

export const createBrowserTabRegistry = (
  publishEvent: (event: BrowserHostEvent) => void,
): BrowserTabRegistry => {
  const records = new Map<string, BrowserTabRecord>();
  const listeners = new Set<(event: BrowserHostEvent) => void>();
  const changeListeners = new Set<BrowserTabChangeListener>();
  const publish = (event: BrowserHostEvent): void => {
    publishEvent(event);
    for (const listener of Array.from(listeners)) {
      listener(event);
    }
  };
  const changed = (previous: BrowserTabSummary | null, next: BrowserTabSummary | null): void => {
    for (const listener of Array.from(changeListeners)) {
      listener(previous, next);
    }
  };

  return {
    get: (tabId) => records.get(tabId),
    require: (tabId, operation) => {
      const record = records.get(tabId);
      return record
        ? Effect.succeed(record)
        : Effect.fail(
            new BrowserServiceError({
              code: "browser_tab_not_found",
              operation,
              message: "This browser tab no longer exists.",
              tabId,
            }),
          );
    },
    list: () => Array.from(records.values(), (record) => record.summary),
    ownerTabs: (owner) => {
      const ownerKey = browserTabOwnerKey(owner);
      return Array.from(records.values()).filter((record) => record.ownerKey === ownerKey);
    },
    workspaceTabs: (workspaceId) =>
      Array.from(records.values()).filter((record) => record.workspaceId === workspaceId),
    add: (added) => {
      const summary = fitSummary(added);
      const record: BrowserTabRecord = {
        tabId: summary.tabId,
        workspaceId: summary.owner.workspaceId,
        ownerKey: browserTabOwnerKey(summary.owner),
        summary,
      };
      records.set(summary.tabId, record);
      publish({ type: "tab_upserted", tab: summary });
      changed(null, summary);
      return record;
    },
    update: (tabId, change) => {
      const record = records.get(tabId);
      if (!record) {
        return;
      }
      const next = fitSummary(change(record.summary));
      if (sameSummary(record.summary, next)) {
        return;
      }
      const previous = record.summary;
      record.summary = { ...next, revision: previous.revision + 1 };
      publish({ type: "tab_upserted", tab: record.summary });
      changed(previous, record.summary);
    },
    remove: (tabId) => {
      const record = records.get(tabId);
      if (!record) {
        return;
      }
      records.delete(tabId);
      publish({ type: "tab_closed", tabId, owner: record.summary.owner });
      changed(record.summary, null);
    },
    publish,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onTabChange: (listener) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };
};

const sameSummary = (left: BrowserTabSummary, right: BrowserTabSummary): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const limitPromptUrl = (prompt: BrowserPrompt): BrowserPrompt => {
  switch (prompt.kind) {
    case "certificate":
      return { ...prompt, url: limitBrowserUrl(prompt.url) };
    case "leave_page":
      return { ...prompt, url: prompt.url === null ? null : limitBrowserUrl(prompt.url) };
    default:
      return prompt;
  }
};

/** Pages can have URLs of any length. Tab state keeps copies that fit the contract. */
const fitSummary = (summary: BrowserTabSummary): BrowserTabSummary => ({
  ...summary,
  url: limitBrowserUrl(summary.url),
  // A page can set any title. Clients keep titles of a bounded length, such as in recent pages.
  title: summary.title === null ? null : summary.title.slice(0, BROWSER_TITLE_MAX_LENGTH),
  error:
    summary.error === null ? null : { ...summary.error, url: limitBrowserUrl(summary.error.url) },
  prompts: summary.prompts.map(limitPromptUrl),
  downloads: summary.downloads.map((download) => ({
    ...download,
    url: limitBrowserUrl(download.url),
  })),
});
