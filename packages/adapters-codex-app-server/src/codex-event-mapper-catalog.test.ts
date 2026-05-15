import { describe, expect, test } from "bun:test";
import { CODEX_EVENT_MAPPERS } from "./event-mappers";

describe("Codex event mapper catalog", () => {
  test("every mapper implements the live/thread contract", () => {
    expect(CODEX_EVENT_MAPPERS.length).toBeGreaterThan(0);
    for (const mapper of CODEX_EVENT_MAPPERS) {
      expect(mapper.name).toBeTruthy();
      expect(mapper.createState).toBeFunction();
      expect(mapper.fromLive).toBeFunction();
      expect(mapper.fromThreadItem).toBeFunction();
    }
  });

  test("specific mappers run before generic fallbacks", () => {
    const names = CODEX_EVENT_MAPPERS.map((mapper) => mapper.name);
    expect(names.indexOf("todo")).toBeLessThan(names.indexOf("dynamic_tool"));
    expect(names.indexOf("web_search")).toBeLessThan(names.indexOf("dynamic_tool"));
    expect(names[names.length - 1]).toBe("hidden_item");
  });
});
