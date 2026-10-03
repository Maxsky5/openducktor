import { expect, test } from "bun:test";
import { normalizeSessionErrorMessage } from "./session-error-message";

test("normalizes quoted runtime errors and JSON message envelopes", () => {
  expect(normalizeSessionErrorMessage("  “Connection closed”  ")).toBe("Connection closed");
  expect(normalizeSessionErrorMessage('{"message":"  Permission denied  "}')).toBe(
    "Permission denied",
  );
  expect(
    normalizeSessionErrorMessage('{"message":"", "error":{"message":"  Runtime stopped  "}}'),
  ).toBe("Runtime stopped");
});

test("preserves runtime details when no string message can be extracted", () => {
  for (const value of ["{invalid JSON}", '{"error":{"message":42}}', '{"code":"EACCES"}']) {
    expect(normalizeSessionErrorMessage(`  ${value}  `)).toBe(value);
  }
});
