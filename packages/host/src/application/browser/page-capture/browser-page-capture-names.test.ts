import { describe, expect, test } from "bun:test";
import { componentName, type PageFiber } from "./browser-page-capture-names";

const fiber = (tag: number, type: PageFiber["type"]): PageFiber => ({ tag, type, return: null });

describe("componentName", () => {
  test("skips an anonymous component, whose name is empty", () => {
    expect(componentName(fiber(0, { name: "" }))).toBeNull();
    expect(componentName(fiber(14, { type: { name: "" } }))).toBeNull();
  });

  test("takes the first name that is not empty", () => {
    expect(componentName(fiber(11, { displayName: "", render: { name: "Field" } }))).toBe("Field");
    expect(componentName(fiber(0, { displayName: "Save button", name: "SaveButton" }))).toBe(
      "Save button",
    );
  });

  test("names no fiber that is not a component", () => {
    expect(componentName(fiber(5, { name: "div" }))).toBeNull();
    expect(componentName(fiber(0, null))).toBeNull();
  });
});
