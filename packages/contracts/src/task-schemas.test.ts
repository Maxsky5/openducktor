import { describe, expect, test } from "bun:test";
import { taskActionSchema } from "./task-schemas";

describe("task schemas", () => {
  test("accepts the manual close task action", () => {
    expect(taskActionSchema.parse("close_task")).toBe("close_task");
  });
});
