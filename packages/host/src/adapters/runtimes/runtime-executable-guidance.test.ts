import { describe, expect, test } from "bun:test";
import {
  incompatibleRuntimeExecutableMessage,
  type RuntimeExecutableGuidance,
  runtimeExecutableStartError,
} from "./runtime-executable-guidance";

const guidance: RuntimeExecutableGuidance = {
  kind: "codex",
  requirement: "OpenDucktor needs Codex 9.",
  update: "run `codex update`",
};

const startMessage = (detail: string): string =>
  runtimeExecutableStartError({
    guidance,
    operation: "test.start",
    executablePath: "/usr/local/bin/codex",
    detail,
  }).message;

describe("runtime executable guidance", () => {
  test("names the problem, the requirement, and the update for an incompatible executable", () => {
    expect(incompatibleRuntimeExecutableMessage(guidance, "/usr/local/bin/codex")).toBe(
      "Codex at '/usr/local/bin/codex' is not compatible with OpenDucktor. OpenDucktor needs Codex 9. Run `codex update`, or select another Codex executable. Then try again.",
    );
  });

  test("shows the runtime output as one plain line", () => {
    expect(
      startMessage("\u001b[31mError loading configuration:\u001b[0m\nmissing field `command`\n"),
    ).toBe(
      "Codex at '/usr/local/bin/codex' did not start: Error loading configuration: missing field `command`. Fix the reported problem, or run `codex update`. Then try again.",
    );
  });

  test("keeps the end of long runtime output", () => {
    expect(startMessage(`${"x".repeat(2_000)} fatal error`)).toContain(
      `did not start: …${"x".repeat(588)} fatal error. Fix the reported problem`,
    );
  });
});
