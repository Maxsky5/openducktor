import { describe, expect, test } from "bun:test";
import { resolveAgentSessionAccentColor } from "./agent-accent-color";

describe("agent session runtime identity", () => {
  test("does not guess a runtime accent for an unknown session", () => {
    expect(resolveAgentSessionAccentColor({ runtimeKind: null })).toBeUndefined();
    expect(resolveAgentSessionAccentColor({})).toBeUndefined();
  });
});
