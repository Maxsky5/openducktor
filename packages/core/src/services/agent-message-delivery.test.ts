import { CLAUDE_RUNTIME_CAPABILITIES, CODEX_RUNTIME_CAPABILITIES } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";

import { resolveRuntimeSteeringAvailability } from "./agent-message-delivery";

const claude = { label: "Claude", capabilities: CLAUDE_RUNTIME_CAPABILITIES };

const withoutSteering = {
  label: "Runtime",
  capabilities: {
    ...claude.capabilities,
    messageDelivery: { minimumSteeringRuntimeVersion: null },
  },
};

describe("resolveRuntimeSteeringAvailability", () => {
  test("allows steering at or above the minimum version in any version text", () => {
    expect(resolveRuntimeSteeringAvailability(claude, "2.1.286 (Claude Code)")).toEqual({
      available: true,
    });
    expect(resolveRuntimeSteeringAvailability(claude, "2.10.0 (Claude Code)")).toEqual({
      available: true,
    });
    expect(
      resolveRuntimeSteeringAvailability(
        { label: "Codex", capabilities: CODEX_RUNTIME_CAPABILITIES },
        "codex-cli 0.106.0",
      ),
    ).toEqual({ available: true });
  });

  test("names the required update for an older runtime", () => {
    expect(resolveRuntimeSteeringAvailability(claude, "2.1.99 (Claude Code)")).toEqual({
      available: false,
      reason: "Claude 2.1.99 cannot steer running work. Update Claude to 2.1.286 or later.",
    });
  });

  test("blocks steering when the runtime version is unknown", () => {
    expect(resolveRuntimeSteeringAvailability(claude, null)).toEqual({
      available: false,
      reason: "OpenDucktor cannot read the Claude version. Steering needs Claude 2.1.286 or later.",
    });
    expect(resolveRuntimeSteeringAvailability(claude, "development build").available).toBe(false);
  });

  test("blocks steering for a runtime that cannot steer", () => {
    expect(resolveRuntimeSteeringAvailability(withoutSteering, "9.9.9")).toEqual({
      available: false,
      reason: "Runtime cannot send a message to running work.",
    });
  });
});
