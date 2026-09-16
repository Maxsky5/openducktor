import { describe, expect, test } from "bun:test";
import {
  buildTaskDescriptionPreviewMarkdown,
  TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS,
} from "./agent-chat-task-description-preview";

describe("buildTaskDescriptionPreviewMarkdown", () => {
  test("keeps a short description without a diagram unchanged", () => {
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

  test("renders a diagram fence as code", () => {
    const description = [
      "Text before.",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "Text after.",
    ].join("\n");
    const preview = buildTaskDescriptionPreviewMarkdown(description);

    expect(preview).toBe(
      ["Text before.", "", "```", "graph TD", "  A --> B", "```", "", "Text after."].join("\n"),
    );
  });

  test("renders a diagram fence that the character budget cuts as code", () => {
    const description = [
      "x".repeat(400),
      "",
      "```mermaid",
      "graph TD",
      "  A[One] --> B[Two]",
      "  B[Two] --> C[Three]",
      "  C[Three] --> D[Four]",
    ].join("\n");
    const preview = buildTaskDescriptionPreviewMarkdown(description);

    expect(preview).toContain("x".repeat(400));
    expect(preview).toContain("graph TD");
    expect(preview).not.toContain("mermaid");
  });

  test("renders a diagram fence in a blockquote or a list item as code", () => {
    const blockquote = ["> ```mermaid", "> graph TD", ">   A --> B", "> ```"].join("\n");
    const list = ["- Item", "", "    ```mermaid", "    graph TD", "    ```"].join("\n");

    expect(buildTaskDescriptionPreviewMarkdown(blockquote)).toBe(
      ["> ```", "> graph TD", ">   A --> B", "> ```"].join("\n"),
    );
    expect(buildTaskDescriptionPreviewMarkdown(list)).toBe(
      ["- Item", "", "    ```", "    graph TD", "    ```"].join("\n"),
    );
  });

  test("keeps a fence whose info string rules it out", () => {
    const description = "```markdown `literal`\nThis remains plain text";

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("keeps a non-diagram fence unchanged", () => {
    const description = ["```js", "const answer = 42;", "```"].join("\n");

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });
});
