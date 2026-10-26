import { describe, expect, test } from "bun:test";
import type {
  BrowserEngineState,
  BrowserHostEvent,
  BrowserTabSummary,
} from "@openducktor/contracts";
import {
  connectionReconnectedEvent,
  type ConnectionControlEvent,
} from "../recovery/connection-control-events";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
} from "../test-support/browser-tab-fixtures";
import { type BrowserTabsChange, createBrowserTabsStore } from "./browser-tabs-store";

const READY: BrowserEngineState = {
  kind: "ready",
  engine: "chrome_for_testing",
};

const deferred = <A>() => {
  let resolve: (value: A) => void = () => {};
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const createHarness = (shows: (tab: BrowserTabSummary) => boolean = () => true) => {
  let listener: (event: BrowserHostEvent | ConnectionControlEvent) => void = () => {};
  let tabsRead = deferred<BrowserTabSummary[]>();
  let reads = 0;
  const store = createBrowserTabsStore({
    shows,
    readTabs: () => {
      reads += 1;
      return tabsRead.promise;
    },
    readEngine: async () => READY,
    subscribe: async (next) => {
      listener = next;
      return () => {};
    },
  });
  const changes: BrowserTabsChange[] = [];
  store.onChange((change) => changes.push(change));
  return {
    store,
    changes,
    emit: (event: BrowserHostEvent | ConnectionControlEvent) => listener(event),
    answer: (tabs: BrowserTabSummary[]) => tabsRead.resolve(tabs),
    /** The answer of the read that runs now, for a test that answers reads out of order. */
    currentAnswer: () => tabsRead.resolve,
    nextRead: () => {
      tabsRead = deferred();
    },
    reads: () => reads,
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("browser tabs store", () => {
  test("ignores the tabs that this client does not show, and their notices and closes", async () => {
    const harness = createHarness((tab) => tab.createdBy === "user");
    const userTab = createBrowserTabSummaryFixture({ tabId: browserTabIdFixture(1) });
    const agentTab = createBrowserTabSummaryFixture({
      tabId: browserTabIdFixture(2),
      createdBy: "agent",
    });
    const started = harness.store.start();
    await flush();
    harness.answer([userTab, agentTab]);
    await started;

    harness.emit({ type: "tab_upserted", tab: { ...agentTab, revision: agentTab.revision + 1 } });
    harness.emit({
      type: "notice",
      tabId: agentTab.tabId,
      owner: agentTab.owner,
      notice: { kind: "popup_limit", limit: 8 },
    });
    harness.emit({ type: "tab_closed", tabId: agentTab.tabId, owner: agentTab.owner });

    expect(Array.from(harness.store.getSnapshot().tabs.keys())).toEqual([userTab.tabId]);
    expect(harness.changes).toEqual([{ kind: "tab_added", tab: userTab }]);
  });

  test("keeps the newer revision when an event arrives during the baseline read", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    await flush();
    harness.emit({
      type: "tab_upserted",
      tab: createBrowserTabSummaryFixture({ revision: 3, url: "http://localhost:3000/new" }),
    });
    harness.answer([
      createBrowserTabSummaryFixture({ revision: 2, url: "http://localhost:3000/old" }),
    ]);
    await started;

    const snapshot = harness.store.getSnapshot();
    expect(snapshot.status).toBe("ready");
    expect(snapshot.engine).toEqual(READY);
    expect(Array.from(snapshot.tabs.values()).map((tab) => tab.url)).toEqual([
      "http://localhost:3000/new",
    ]);
  });

  test("keeps a tab that an event added while the baseline read ran", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    await flush();
    const tab = createBrowserTabSummaryFixture();
    harness.emit({ type: "tab_upserted", tab });
    harness.answer([]);
    await started;

    expect(Array.from(harness.store.getSnapshot().tabs.keys())).toEqual([tab.tabId]);
    expect(harness.changes.map((change) => change.kind)).toEqual(["tab_added"]);
  });

  test("applies only the latest of two baseline reads", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    harness.answer([]);
    await started;
    harness.nextRead();
    harness.emit(connectionReconnectedEvent(true, { hostChanged: false, missedEventNames: [] }));
    const answerOlder = harness.currentAnswer();
    harness.nextRead();
    harness.emit(connectionReconnectedEvent(true, { hostChanged: false, missedEventNames: [] }));
    const tab = createBrowserTabSummaryFixture();

    harness.answer([tab]);
    await flush();
    answerOlder([]);
    await flush();

    expect(Array.from(harness.store.getSnapshot().tabs.keys())).toEqual([tab.tabId]);
    expect(harness.changes.map((change) => change.kind)).toEqual(["tab_added"]);
  });

  test("drops a tab that closed while the baseline read ran", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    await flush();
    const tab = createBrowserTabSummaryFixture();
    harness.emit({ type: "tab_closed", tabId: tab.tabId, owner: tab.owner });
    harness.answer([tab]);
    await started;

    expect(harness.store.getSnapshot().tabs.size).toBe(0);
  });

  test("reports added, updated, and closed tabs and notices", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    harness.answer([]);
    await started;
    const tab = createBrowserTabSummaryFixture();

    harness.emit({ type: "tab_upserted", tab });
    harness.emit({ type: "tab_upserted", tab: { ...tab, revision: 2, title: "Next" } });
    harness.emit({
      type: "notice",
      tabId: tab.tabId,
      owner: tab.owner,
      notice: { kind: "scheme_refused", scheme: "mailto" },
    });
    harness.emit({ type: "tab_closed", tabId: tab.tabId, owner: tab.owner });

    expect(harness.changes.map((change) => change.kind)).toEqual([
      "tab_added",
      "tab_updated",
      "notice",
      "tab_closed",
    ]);
  });

  test("reads the baseline again after a reconnect that missed events", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    harness.answer([createBrowserTabSummaryFixture()]);
    await started;
    harness.nextRead();

    harness.emit(connectionReconnectedEvent(false, { hostChanged: false, missedEventNames: [] }));
    expect(harness.reads()).toBe(1);
    harness.emit(connectionReconnectedEvent(true, { hostChanged: false, missedEventNames: [] }));
    harness.answer([]);
    await flush();

    expect(harness.reads()).toBe(2);
    expect(harness.store.getSnapshot().tabs.size).toBe(0);
    expect(harness.changes.at(-1)).toMatchObject({ kind: "tab_closed" });
  });

  test("takes the state of a restarted host, whose revisions start again", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    harness.answer([
      createBrowserTabSummaryFixture({ revision: 40, url: "http://localhost:3000/old" }),
    ]);
    await started;
    harness.nextRead();

    harness.emit(connectionReconnectedEvent(true, { hostChanged: false, missedEventNames: [] }));
    harness.emit({
      type: "tab_upserted",
      tab: createBrowserTabSummaryFixture({ revision: 2, url: "http://localhost:3000/live" }),
    });
    expect(harness.store.getSnapshot().tabs.get(browserTabIdFixture(1))?.url).toBe(
      "http://localhost:3000/live",
    );
    harness.answer([
      createBrowserTabSummaryFixture({ revision: 1, url: "http://localhost:3000/listed" }),
    ]);
    await flush();

    expect(harness.store.getSnapshot().tabs.get(browserTabIdFixture(1))).toMatchObject({
      revision: 2,
      url: "http://localhost:3000/live",
    });
    harness.emit({
      type: "tab_upserted",
      tab: createBrowserTabSummaryFixture({ revision: 1, url: "http://localhost:3000/stale" }),
    });
    expect(harness.store.getSnapshot().tabs.get(browserTabIdFixture(1))?.url).toBe(
      "http://localhost:3000/live",
    );
  });

  test("applies engine changes", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    harness.answer([]);
    await started;

    harness.emit({
      type: "engine_changed",
      state: { kind: "downloading", version: "1", receivedBytes: 5, totalBytes: 10 },
    });

    expect(harness.store.getSnapshot().engine).toMatchObject({ kind: "downloading" });
  });

  test("passes a failed tab save to the change listeners", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    harness.answer([]);
    await started;

    harness.emit({ type: "tabs_not_saved", message: "The disk is full." });

    expect(harness.changes).toEqual([{ kind: "tabs_not_saved", message: "The disk is full." }]);
  });

  test("waits until the tab list has a new tab, or until the tab closes", async () => {
    const harness = createHarness();
    const started = harness.store.start();
    harness.answer([]);
    await started;
    const tab = createBrowserTabSummaryFixture();
    let listed = false;
    const waiting = harness.store.untilListed(tab.tabId).then(() => {
      listed = true;
    });

    await flush();
    expect(listed).toBe(false);
    harness.emit({ type: "tab_upserted", tab });
    await waiting;

    await harness.store.untilListed(tab.tabId);
    const closing = harness.store.untilListed("other-tab");
    harness.emit({ type: "tab_closed", tabId: "other-tab", owner: tab.owner });
    await closing;
  });
});
