import { describe, expect, test } from "bun:test";
import {
  cleanRuntimeOutput,
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

  test("shows the runtime output as one plain sentence", () => {
    expect(
      startMessage("\u001b[31merror loading configuration:\u001b[0m\nmissing field `command`\n"),
    ).toBe(
      "Codex at '/usr/local/bin/codex' did not start. Error loading configuration: missing field `command`. Fix the reported problem, or run `codex update`. Then try again.",
    );
  });

  test("removes terminal codes and tabs from a printed line", () => {
    expect(cleanRuntimeOutput("\u001b[32mopencode serve\u001b[0m\tready")).toBe(
      "opencode serve ready",
    );
  });

  test("keeps the end of long runtime output", () => {
    const output = `${"x".repeat(2_000)}\tfatal error.`;

    const cleaned = cleanRuntimeOutput(output);

    expect(cleaned).toStartWith("…");
    expect(cleaned).toEndWith("x fatal error");
    expect(cleaned.length).toBeLessThan(output.length);
  });
});
