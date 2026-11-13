import { describe, expect, test } from "bun:test";
import { toolIcon } from "./tool-icon";

describe("tool icons", () => {
  test("use the desktop icon of each tool type", () => {
    expect(toolIcon({ tool: "read", toolType: "read" })).toBe("file-text");
    expect(toolIcon({ tool: "bash", toolType: "bash" })).toBe("terminal");
    expect(toolIcon({ tool: "todowrite", toolType: "todo" })).toBe("list-todo");
    expect(toolIcon({ tool: "edit", toolType: "file_edit" })).toBe("pencil-line");
  });

  test("draw a skill as a scroll and other tools as a wrench, as on desktop", () => {
    expect(toolIcon({ tool: "skill", toolType: "generic" })).toBe("scroll-text");
    expect(toolIcon({ tool: "custom", toolType: "generic" })).toBe("wrench");
    expect(toolIcon({ tool: "question", toolType: "question" })).toBe("wrench");
  });

  test("draw the icon of an ODT tool card in place of the tool type", () => {
    expect(toolIcon({ tool: "odt_apply_workflow_event", toolType: "workflow" }, "workflow")).toBe(
      "workflow",
    );
    expect(
      toolIcon({ tool: "odt_set_pull_request", toolType: "workflow" }, "git-pull-request"),
    ).toBe("git-pull-request");
  });
});
