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

  test("keeps an image token that crosses the character budget", () => {
    const description = `${"a".repeat(470)}\n\n![Screenshot](odt-asset:550e8400-e29b-41d4-a716-446655440000 "shot.png")`;

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("drops an image token without a closing bracket", () => {
    const description = `${"a".repeat(472)}![Screenshot](odt-asset:550e8400-e29b-41d4-a716-446655440000`;

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe("a".repeat(472));
  });

  test("keeps an image token whole when its title contains a closing bracket", () => {
    const description = `${"a".repeat(470)}![s](u "a)b")`;

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("keeps an image token whole when its title uses single quotes", () => {
    const description = `${"a".repeat(470)}![s](u 'a)b')`;

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("keeps an image token whole when its destination holds an escaped bracket", () => {
    const description = `${"a".repeat(472)}![s](a\\)b)`;

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("keeps a reference-style image token", () => {
    const description = "![Architecture][diagram]";

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("keeps a reference-style image token that crosses the character budget", () => {
    const description = `${"a".repeat(470)}\n\n![Architecture][diagram]`;

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("drops an image token whose closing bracket is too far after the budget", () => {
    const description = `${"a".repeat(470)}![Screenshot](odt-asset:${"9".repeat(400)})`;

    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe("a".repeat(470));
  });

  test("keeps the preview bounded for a megabyte image token", () => {
    const description = `${"a".repeat(470)}![Screenshot](odt-asset:${"9".repeat(1_000_000)})`;
    const preview = buildTaskDescriptionPreviewMarkdown(description);

    expect(preview).toBe("a".repeat(470));
    expect(preview.length).toBeLessThanOrEqual(TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS);
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
