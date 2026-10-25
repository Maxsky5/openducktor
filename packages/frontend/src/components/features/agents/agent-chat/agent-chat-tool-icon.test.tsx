import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { toolIcon } from "./agent-chat-tool-icon";

describe("toolIcon", () => {
  test("uses the scroll icon for skill tools", () => {
    for (const tool of ["skill", "Skill"]) {
      expect(renderToStaticMarkup(toolIcon({ tool, toolType: "generic" }))).toContain(
        "lucide-scroll-text",
      );
    }
  });

  test("keeps the wrench icon for other generic tools", () => {
    expect(
      renderToStaticMarkup(toolIcon({ tool: "custom_runtime_tool", toolType: "generic" })),
    ).toContain("lucide-wrench");
  });
});
