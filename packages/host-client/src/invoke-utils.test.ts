import type {} from "./bun-test";
import { toCommandArgs } from "./invoke-utils";

describe("toCommandArgs", () => {
  test("validates JSON object arguments without changing them", () => {
    const args = toCommandArgs({
      taskId: "task-1",
      options: { includeArchived: false },
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
    expect(() => toCommandArgs({ optional: undefined })).toThrow(
      "Host command arguments must be a JSON object.",
    );
    expect(() => toCommandArgs({ count: Number.NaN })).toThrow(
      "Host command arguments must be a JSON object.",
    );
  });
});
