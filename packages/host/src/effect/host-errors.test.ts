import { describe, expect, test } from "bun:test";
import { Cause } from "effect";
import { causeChainMessage, causeMessage, HostValidationError } from "./host-errors";

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

describe("causeChainMessage", () => {
  test("lists each message of the cause chain once, also from a plain RPC error", () => {
    const rpc = { code: -32600, message: "chatgpt authentication required" };
    const request = new Error("Codex request failed", { cause: rpc });
    const query = new Error("The runtime query failed.", { cause: request });

    expect(causeChainMessage(query)).toBe(
      "The runtime query failed. Cause: Codex request failed Cause: chatgpt authentication required",
    );
    expect(causeChainMessage(new Error("Same", { cause: new Error("Same") }))).toBe("Same");
  });
});
