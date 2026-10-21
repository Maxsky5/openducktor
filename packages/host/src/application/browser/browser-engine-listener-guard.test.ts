import { describe, expect, test } from "bun:test";
import type { BrowserEngineEvent } from "../../ports/browser-engine-port";
import { createBrowserEngineTestDouble } from "../../test-support/browser-engine-test-double";
import { guardBrowserEngineListeners } from "./browser-engine-listener-guard";

describe("guardBrowserEngineListeners", () => {
  test("reports a listener that throws and still calls the other listeners", () => {
    const double = createBrowserEngineTestDouble();
    const failures: { operation: string; cause: unknown }[] = [];
    const engine = guardBrowserEngineListeners(double.engine, (operation, cause) => {
      failures.push({ operation, cause });
    });
    const received: BrowserEngineEvent[] = [];
    engine.subscribe(() => {
      throw new Error("bad event");
    });
    engine.subscribe((event) => received.push(event));
    const event: BrowserEngineEvent = { type: "tab_detached", tabId: "tab-1" };

    double.emit(event);

    expect(received).toEqual([event]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.operation).toBe("browser.engine.event");
  });
});
