import type {} from "./bun-test";
import { toCommandArgs } from "./invoke-utils";

describe("toCommandArgs", () => {
  test("serializes JSON object arguments", () => {
    const args = toCommandArgs({
      taskId: "task-1",
      options: { includeArchived: false },
      optional: undefined,
    });

    expect(args).toEqual({
      taskId: "task-1",
      options: { includeArchived: false },
    });
  });

  test("rejects values that cannot cross the host command boundary as JSON objects", () => {
    expect(() => toCommandArgs(["task-1"])).toThrow(
      "Host command arguments must be a JSON object.",
    );
    expect(() => toCommandArgs(undefined)).toThrow("Host command arguments must be a JSON object.");
  });
});
