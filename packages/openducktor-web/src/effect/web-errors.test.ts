import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { causeToWebBoundaryError, WebOperationError, WebValidationError } from "./web-errors";

describe("web Effect boundary errors", () => {
  test("preserves multiple typed failures on boundary crossing", () => {
    const firstFailure = new WebValidationError({ field: "first", message: "first failed" });
    const secondFailure = new WebValidationError({ field: "second", message: "second failed" });
    const cause = Cause.parallel(Cause.fail(firstFailure), Cause.fail(secondFailure));

    const error = causeToWebBoundaryError(cause);

    expect(error).toBeInstanceOf(WebOperationError);
    expect(error).toMatchObject({
      _tag: "WebOperationError",
      operation: "web.effect.run",
      message: "Multiple Effect failures crossed the web boundary.",
      details: { failureMessages: ["first failed", "second failed"] },
    });
    expect(Reflect.get(error, "cause")).toEqual({ failures: [firstFailure, secondFailure] });
  });

  test("returns one typed failure unchanged", () => {
    const failure = new WebValidationError({ field: "name", message: "name failed" });
    const exit = Effect.runSyncExit(Effect.fail(failure));
    if (!Exit.isFailure(exit)) {
      throw new Error("Expected failed exit");
    }

    expect(causeToWebBoundaryError(exit.cause)).toBe(failure);
  });
});
