import { describe, expect, test } from "bun:test";
import { CodexSubagentLinkState } from "./codex-subagent-link-state";
import { createCodexEventMappers } from "./event-mappers";

describe("Codex event mapper catalog", () => {
  const createMappers = () => createCodexEventMappers(new CodexSubagentLinkState());

  test("every mapper implements the live/thread contract", () => {
    const mappers = createMappers();
    expect(mappers.length).toBeGreaterThan(0);
    for (const mapper of mappers) {
      expect(mapper.name).toBeTruthy();
      expect(mapper.createState).toBeFunction();
      expect(mapper.fromLive).toBeFunction();
      expect(mapper.fromThreadItem).toBeFunction();
    }
  });

  test("specific mappers run before generic fallbacks", () => {
    const names = createMappers().map((mapper) => mapper.name);
    expect(names.indexOf("todo")).toBeLessThan(names.indexOf("dynamic_tool"));
    expect(names.indexOf("web_search")).toBeLessThan(names.indexOf("dynamic_tool"));
    expect(names.indexOf("subagent")).toBeLessThan(names.indexOf("collab_tool"));
    expect(names[names.length - 1]).toBe("hidden_item");
  });
});
