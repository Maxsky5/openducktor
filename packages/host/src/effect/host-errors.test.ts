import { describe, expect, test } from "bun:test";
import { Cause } from "effect";
import { causeMessage, HostValidationError } from "./host-errors";

describe("causeMessage", () => {
  test("keeps the message of each failure and defect, without tags or stacks", () => {
    const cause = Cause.combine(
      Cause.fail(new HostValidationError({ message: "Saved path is missing: /tmp/opencode" })),
      Cause.die(new Error("Socket closed.")),
    );

    expect(causeMessage(cause)).toBe("Saved path is missing: /tmp/opencode\nSocket closed.");
  });

  test("describes an interruption", () => {
    expect(causeMessage(Cause.interrupt())).toBe("The operation was interrupted.");
  });
});
