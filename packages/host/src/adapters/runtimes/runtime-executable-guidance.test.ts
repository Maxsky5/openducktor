import { describe, expect, test } from "bun:test";
import { runtimeExecutableStartFailureMessage } from "./runtime-executable-guidance";

describe("runtimeExecutableStartFailureMessage", () => {
  test("shows the runtime output as one plain line", () => {
    const message = runtimeExecutableStartFailureMessage(
      "codex",
      "/usr/local/bin/codex",
      "\u001b[31mError loading configuration:\u001b[0m\nmissing field `command`\n",
    );

    expect(message).toStartWith(
      "Codex at '/usr/local/bin/codex' did not start: Error loading configuration: missing field `command`. ",
    );
  });

  test("keeps the end of long runtime output", () => {
    const message = runtimeExecutableStartFailureMessage(
      "claude",
      "/bin/claude",
      `${"x".repeat(2_000)} fatal error`,
    );

    expect(message).toContain(`did not start: …${"x".repeat(588)} fatal error. OpenDucktor needs`);
  });
});
