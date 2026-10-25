import { describe, expect, test } from "bun:test";
import { routeParam } from "./route-params";

describe("routeParam", () => {
  test("reads the first value of a param", () => {
    expect(routeParam("task-1")).toBe("task-1");
    expect(routeParam(["task-1", "task-2"])).toBe("task-1");
  });

  test("treats a missing or blank param as absent", () => {
    expect(routeParam(undefined)).toBeNull();
    expect(routeParam([])).toBeNull();
    expect(routeParam("  ")).toBeNull();
  });
});
