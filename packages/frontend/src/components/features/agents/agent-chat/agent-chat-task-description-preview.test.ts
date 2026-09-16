import { describe, expect, test } from "bun:test";
import {
  buildTaskDescriptionPreviewMarkdown,
  TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS,
} from "./agent-chat-task-description-preview";

describe("buildTaskDescriptionPreviewMarkdown", () => {
  test("keeps a short description unchanged", () => {
    const description = "### Context\n\n- Failure: CI run\n- Test: workspace-session";
    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("keeps body text when a short heading precedes a long paragraph", () => {
    const preview = buildTaskDescriptionPreviewMarkdown(`### Context\n${"b".repeat(1000)}`);

    expect(preview).toHaveLength(TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS);
    expect(preview.startsWith("### Context\nbbb")).toBe(true);
  });

  test("bounds a long description and drops the distant tail", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `Line ${index + 1}`);
    const description = lines.join("\n");
    const preview = buildTaskDescriptionPreviewMarkdown(description);

    expect(preview).toBe(description.slice(0, TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS));
    expect(preview.split("\n")[0]).toBe("Line 1");
    expect(preview).not.toContain("Line 200");
  });

  test("cuts a single long line at the character budget", () => {
    const preview = buildTaskDescriptionPreviewMarkdown("a".repeat(1000));

    expect(preview).toBe("a".repeat(TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS));
  });

  test("does not split a surrogate pair at the character budget", () => {
    const emoji = "\u{1F600}";
    const boundary = buildTaskDescriptionPreviewMarkdown(
      `${"a".repeat(479)}${emoji}${"b".repeat(10)}`,
    );
    const exact = buildTaskDescriptionPreviewMarkdown(
      `${"a".repeat(478)}${emoji}${"b".repeat(10)}`,
    );

    expect(boundary).toBe("a".repeat(479));
    expect(/\p{Surrogate}$/u.test(boundary)).toBe(false);
    expect(exact).toBe(`${"a".repeat(478)}${emoji}`);
    expect(exact.length).toBe(TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS);
  });

  test("hides a valid front matter block and bounds the body", () => {
    const description = [
      "---",
      "priority: high",
      "title: scratch",
      "---",
      "",
      "Body text. ".repeat(60),
    ].join("\n");
    const preview = buildTaskDescriptionPreviewMarkdown(description);

    expect(preview.startsWith("Body text.")).toBe(true);
    expect(preview).not.toContain("priority: high");
    expect(preview.length).toBeLessThanOrEqual(TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS);
  });

  test("leaves fences untouched for the renderer to handle", () => {
    const diagram = ["Text before.", "", "```mermaid", "graph TD", "  A --> B", "```"].join("\n");
    const indentedCode = ["Text before.", "", "    ```mermaid", "    graph TD"].join("\n");

    expect(buildTaskDescriptionPreviewMarkdown(diagram)).toBe(diagram);
    expect(buildTaskDescriptionPreviewMarkdown(indentedCode)).toBe(indentedCode);
    expect(buildTaskDescriptionPreviewMarkdown("- ```mermaid\n  graph TD")).toBe(
      "- ```mermaid\n  graph TD",
    );
  });
});
