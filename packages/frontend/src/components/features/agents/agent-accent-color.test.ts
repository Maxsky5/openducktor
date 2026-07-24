import { describe, expect, test } from "bun:test";
import {
  CLAUDE_SESSION_ACCENT_COLOR,
  CODEX_SESSION_ACCENT_COLOR,
  resolveAgentAccentColor,
  resolveAgentSessionAccentColor,
} from "./agent-accent-color";

describe("agent accent colors", () => {
  test("preserves explicit colors before runtime defaults", () => {
    expect(
      resolveAgentSessionAccentColor({
        agentName: "Hephaestus (Deep Agent)",
        agentColors: { "Hephaestus (Deep Agent)": "#d97706" },
        runtimeKind: "codex",
      }),
    ).toBe("#d97706");
  });

  test("keeps deterministic profile colors for OpenCode profiles", () => {
    const directProfileColor = resolveAgentAccentColor("Hephaestus (Deep Agent)");
    expect(
      resolveAgentSessionAccentColor({
        agentName: "Hephaestus (Deep Agent)",
        agentColors: {},
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
    expect(
      resolveAgentSessionAccentColor({
        agentName: "   ",
        runtimeKind: "codex",
      }),
    ).toBe(CODEX_SESSION_ACCENT_COLOR);
  });

  test("uses the Claude runtime accent when no profile color is available", () => {
    expect(
      resolveAgentSessionAccentColor({
        agentName: undefined,
        runtimeKind: "claude",
      }),
    ).toBe(CLAUDE_SESSION_ACCENT_COLOR);
    expect(
      resolveAgentSessionAccentColor({
        agentName: "   ",
        runtimeKind: "claude",
      }),
    ).toBe(CLAUDE_SESSION_ACCENT_COLOR);
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
    expect(resolveAgentSessionAccentColor({ agentName: "   ", runtimeKind: null })).toBeUndefined();
  });
});
