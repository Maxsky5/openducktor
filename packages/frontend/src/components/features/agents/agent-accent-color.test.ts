import { describe, expect, test } from "bun:test";
import {
  CODEX_SESSION_ACCENT_COLOR,
  resolveAgentAccentColor,
  resolveAgentSessionAccentColor,
} from "./agent-accent-color";

describe("agent accent colors", () => {
  test("preserves explicit colors before runtime defaults", () => {
    expect(
      resolveAgentSessionAccentColor({
        agentName: undefined,
        explicitColor: "#d97706",
        runtimeKind: "codex",
      }),
    ).toBe("#d97706");
  });

  test("keeps deterministic profile colors for OpenCode profiles", () => {
    const directProfileColor = resolveAgentAccentColor("Hephaestus (Deep Agent)");
    expect(
      resolveAgentSessionAccentColor({
        agentName: "Hephaestus (Deep Agent)",
        runtimeKind: "opencode",
      }),
    ).toBe(directProfileColor);
    expect(directProfileColor).toMatch(/^hsl\(\d+ 74% 46%\)$/);
  });

  test("uses the Codex runtime accent when no profile color is available", () => {
    expect(
      resolveAgentSessionAccentColor({
        agentName: undefined,
        runtimeKind: "codex",
      }),
    ).toBe(CODEX_SESSION_ACCENT_COLOR);
  });

  test("does not guess a runtime accent without Codex identity", () => {
    expect(
      resolveAgentSessionAccentColor({
        agentName: undefined,
        runtimeKind: "opencode",
      }),
    ).toBeUndefined();
    expect(
      resolveAgentSessionAccentColor({ agentName: undefined, runtimeKind: null }),
    ).toBeUndefined();
  });
});
