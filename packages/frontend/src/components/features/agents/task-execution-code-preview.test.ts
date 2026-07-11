import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { findCodePreviewLanguage, TaskExecutionCodePreview } from "./task-execution-code-preview";

describe("findCodePreviewLanguage", () => {
  test("selects language support from the complete file name", () => {
    expect(findCodePreviewLanguage("src/components/Panel.tsx")?.name).toBe("TSX");
    expect(findCodePreviewLanguage("package.json")?.name).toBe("JSON");
  });

  test("keeps unknown file types in plain text", () => {
    expect(findCodePreviewLanguage("fixtures/example.unknown-extension")).toBeNull();
  });
});

describe("TaskExecutionCodePreview", () => {
  test("mounts a selectable read-only code document", async () => {
    const view = render(
      createElement(
        "div",
        { style: { height: 400, width: 600 } },
        createElement(TaskExecutionCodePreview, {
          contents: "const answer = 42;",
          fileName: "src/answer.ts",
          theme: "light",
        }),
      ),
    );

    expect(view.container.querySelector(".cm-editor")).toBeTruthy();
    const content = view.container.querySelector<HTMLElement>(".cm-content");
    expect(content?.textContent).toContain("const answer = 42;");
    expect(content?.getAttribute("contenteditable")).toBe("false");

    view.unmount();
    expect(view.container.querySelector(".cm-editor")).toBeNull();
  });

  test("keeps the DOM bounded for long files", () => {
    const contents = Array.from(
      { length: 8_000 },
      (_, index) => `export const value${index + 1} = ${index + 1};`,
    ).join("\n");
    const view = render(
      createElement(
        "div",
        { style: { height: 400, width: 600 } },
        createElement(TaskExecutionCodePreview, {
          contents,
          fileName: "src/large-file.ts",
          theme: "light",
        }),
      ),
    );

    expect(view.container.querySelectorAll("*").length).toBeLessThan(500);

    view.unmount();
  });
});
