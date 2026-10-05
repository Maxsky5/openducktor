import { describe, expect, test } from "bun:test";
import { classifyDiagnosticsQueryError, DiagnosticsQueryTimeoutError } from "./checks";

describe("classifyDiagnosticsQueryError", () => {
  test("keeps query timeout errors explicit", () => {
    expect(classifyDiagnosticsQueryError(new DiagnosticsQueryTimeoutError(15_000))).toEqual({
      message: "Timed out after 15000ms",
      failureKind: "timeout",
    });
  });

  test("treats generic thrown errors as hard failures", () => {
    expect(classifyDiagnosticsQueryError(new Error("Timed out after 15000ms"))).toEqual({
      message: "Timed out after 15000ms",
      failureKind: "error",
    });
  });
});
