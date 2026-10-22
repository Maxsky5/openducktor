import { describe, expect, test } from "bun:test";
import {
  BROWSER_TITLE_MAX_LENGTH,
  BROWSER_URL_MAX_LENGTH,
  type BrowserHostEvent,
} from "@openducktor/contracts";
import { createBrowserTabRegistry } from "./browser-tab-registry";
import { tabId, tabSummary } from "./test-support/browser-service-harness";

describe("createBrowserTabRegistry", () => {
  test("reports each tab change with the summary before and after it", () => {
    const registry = createBrowserTabRegistry(() => {});
    const changes: Array<[string | null, string | null]> = [];
    registry.onTabChange((previous, next) =>
      changes.push([previous?.title ?? null, next?.title ?? null]),
    );

    registry.add(tabSummary({ title: "One" }));
    registry.update(tabId(1), (current) => ({ ...current, title: "Two" }));
    registry.update(tabId(1), (current) => current);
    registry.remove(tabId(1));

    expect(changes).toEqual([
      [null, "One"],
      ["One", "Two"],
      ["Two", null],
    ]);
  });

  test("keeps page URLs of any length within the contract limit", () => {
    const events: BrowserHostEvent[] = [];
    const registry = createBrowserTabRegistry((event) => events.push(event));
    registry.add(tabSummary());

    registry.update(tabId(1), (current) => ({
      ...current,
      url: `http://localhost:3000/app?state=${"a".repeat(9_000)}`,
      prompts: [
        {
          promptId: "p1",
          kind: "leave_page",
          url: `http://localhost:3000/#${"b".repeat(9_000)}`,
          startedByAgent: false,
        },
      ],
    }));

    const updated = registry.get(tabId(1))?.summary;
    expect(updated?.url).toBe("http://localhost:3000/app");
    expect(updated?.prompts).toEqual([
      { promptId: "p1", kind: "leave_page", url: "http://localhost:3000/", startedByAgent: false },
    ]);
    expect(
      events.every(
        (event) => event.type !== "tab_upserted" || event.tab.url.length <= BROWSER_URL_MAX_LENGTH,
      ),
    ).toBe(true);
  });

  test("keeps page titles within the contract limit", () => {
    const registry = createBrowserTabRegistry(() => {});
    registry.add(tabSummary({ title: "t".repeat(2_000) }));
    expect(registry.get(tabId(1))?.summary.title).toHaveLength(BROWSER_TITLE_MAX_LENGTH);

    registry.update(tabId(1), (current) => ({ ...current, title: "u".repeat(2_000) }));

    expect(registry.get(tabId(1))?.summary.title).toBe("u".repeat(BROWSER_TITLE_MAX_LENGTH));
  });
});
