import { describe, expect, test } from "bun:test";
import type { BrowserTabSummary } from "@openducktor/contracts";
import { createMemoryClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createBrowserTabSummaryFixture } from "@/test-utils/session-panel-fixtures";
import { BROWSER_RECENT_PAGES_LIMIT, browserRecentPagesOf } from "./browser-recent-pages";

const WORKSPACE = "recent-pages-workspace";
const STORAGE_KEY = `openducktor:browser-recent-pages:v1:${WORKSPACE}`;

const page = (url: string, overrides: Partial<BrowserTabSummary> = {}): BrowserTabSummary =>
  createBrowserTabSummaryFixture({
    owner: { kind: "task", workspaceId: WORKSPACE, taskId: "task-1" },
    url,
    title: `Title of ${url}`,
    loading: false,
    error: null,
    ...overrides,
  });

/** The recent pages of a new connection, with its storage. */
const setup = () => {
  const storage = createMemoryClientStorage();
  const recent = browserRecentPagesOf(createTestClientConnection({ storage }));
  return { storage, recent };
};

describe("browser recent pages", () => {
  test("keeps the loaded pages of user tabs, newest first, one entry for each URL", () => {
    const { storage, recent } = setup();
    recent.record(page("http://localhost:3000/"));
    recent.record(page("https://example.com/"));
    recent.record(page("http://localhost:3000/", { title: "Dev app" }));

    expect(recent.read(WORKSPACE)).toEqual([
      { url: "http://localhost:3000/", title: "Dev app", favicon: null },
      { url: "https://example.com/", title: "Title of https://example.com/", favicon: null },
    ]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? "null")?.pages).toHaveLength(2);
  });

  test("skips agent tabs, pages that load or failed, and blank tabs", () => {
    const { recent } = setup();
    recent.record(page("https://agent.example/", { createdBy: "agent" }));
    recent.record(page("https://slow.example/", { loading: true }));
    recent.record(
      page("https://down.example/", {
        error: { kind: "load_failed", url: "https://down.example/", message: "Refused." },
      }),
    );
    recent.record(page("about:blank"));

    expect(recent.read(WORKSPACE)).toEqual([]);
  });

  test("keeps at most the limit, and forgets the pages of removed workspaces", () => {
    const { storage, recent } = setup();
    for (let index = 0; index <= BROWSER_RECENT_PAGES_LIMIT; index += 1) {
      recent.record(page(`http://localhost:${3000 + index}/`));
    }

    expect(recent.read(WORKSPACE)).toHaveLength(BROWSER_RECENT_PAGES_LIMIT);
    expect(recent.read(WORKSPACE)[0]?.url).toBe(
      `http://localhost:${3000 + BROWSER_RECENT_PAGES_LIMIT}/`,
    );
    recent.prune(new Set(["another-workspace"]));
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(recent.read(WORKSPACE)).toEqual([]);
  });

  test("keeps the list of each connection in the storage of that connection", () => {
    const local = setup();
    const remote = setup();
    local.recent.record(page("http://localhost:3000/"));

    remote.recent.prune(new Set(["remote-workspace"]));

    expect(local.storage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(local.recent.read(WORKSPACE)).toHaveLength(1);
    expect(remote.recent.read(WORKSPACE)).toEqual([]);
  });
});
