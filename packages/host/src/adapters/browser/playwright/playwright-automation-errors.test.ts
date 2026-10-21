import { describe, expect, test } from "bun:test";
import { errors } from "playwright-core";
import { StaleRefError, toAutomationError } from "./playwright-automation-errors";

describe("toAutomationError", () => {
  test("names a stale ref, a timeout, and the first line of other failures", () => {
    expect(
      toAutomationError(new StaleRefError("Element ref e9 is not on the page."), "Click"),
    ).toMatchObject({
      kind: "ref_stale",
      message: "Element ref e9 is not on the page.",
    });
    expect(
      toAutomationError(new errors.TimeoutError("waiting for locator"), "Click"),
    ).toMatchObject({
      kind: "timeout",
      message: "Click timed out.",
    });
    expect(
      toAutomationError(new Error("Element is not visible\nCall log: ..."), "Hover"),
    ).toMatchObject({ kind: "failed", message: "Hover failed: Element is not visible" });
    expect(toAutomationError("closed", "Type")).toMatchObject({
      kind: "failed",
      message: "Type failed: closed",
    });
  });
});
