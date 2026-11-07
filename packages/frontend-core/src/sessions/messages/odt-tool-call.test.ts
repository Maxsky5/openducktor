import { describe, expect, test } from "bun:test";
import { readOdtToolName } from "./odt-tool-call";

describe("readOdtToolName", () => {
  test.each([
    "odt_apply_workflow_event",
    "openducktor_odt_apply_workflow_event",
    "functions.openducktor_odt_apply_workflow_event",
    "mcp__openducktor__odt_apply_workflow_event",
    " ODT_APPLY_WORKFLOW_EVENT ",
  ])("reads %s as its canonical name", (tool) => {
    expect(readOdtToolName(tool)).toBe("odt_apply_workflow_event");
  });

  test("reads no ODT tool for another tool", () => {
    expect(readOdtToolName("bash")).toBeNull();
    expect(readOdtToolName("other_server.odt_create_task")).toBeNull();
  });
});
