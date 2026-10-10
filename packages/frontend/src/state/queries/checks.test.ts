import { describe, expect, test } from "bun:test";
import { skipToken } from "@tanstack/react-query";
import {
  classifyDiagnosticsQueryError,
  DiagnosticsQueryTimeoutError,
  taskStoreCheckQueryOptionsOrSkip,
} from "./checks";

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

describe("taskStoreCheckQueryOptionsOrSkip", () => {
  test("gives a read without a repository the reserved skipped key", () => {
    const skipped = taskStoreCheckQueryOptionsOrSkip(null);
    const live = taskStoreCheckQueryOptionsOrSkip("/repo");

    expect(Array.from(skipped.queryKey)).toEqual(["checks", "task-store", "skipped"]);
    expect(skipped.queryFn).toBe(skipToken);
    expect(Array.from(live.queryKey)).toEqual(["checks", "task-store", "/repo"]);
  });
});
