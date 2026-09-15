import { describe, expect, test } from "bun:test";
import { buildTaskDescriptionPreviewMarkdown } from "./agent-chat-task-description-preview";

describe("buildTaskDescriptionPreviewMarkdown", () => {
  test("keeps a short description unchanged", () => {
    const description = "### Context\n\n- Failure: CI run\n- Test: workspace-session";
    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("bounds a long description and drops trailing lines", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `Line ${index + 1}`);
    const description = lines.join("\n");
    const preview = buildTaskDescriptionPreviewMarkdown(description);

    expect(preview.length).toBeLessThan(description.length);
    expect(preview.length).toBeLessThan(500);
    expect(description.startsWith(preview)).toBe(true);
    expect(preview.split("\n")[0]).toBe("Line 1");
    expect(preview).not.toContain("Line 200");
  });

  test("cuts at the last complete line", () => {
    const firstLine = "a".repeat(300);
    const preview = buildTaskDescriptionPreviewMarkdown(`${firstLine}\n${"b".repeat(300)}`);

    expect(preview).toBe(firstLine);
  });

  test("cuts a single long line at the character budget", () => {
    const preview = buildTaskDescriptionPreviewMarkdown("a".repeat(1000));

    expect(preview).toBe("a".repeat(480));
  });

  test("keeps content when the description starts with a line break", () => {
    const preview = buildTaskDescriptionPreviewMarkdown(`\n${"a".repeat(1000)}`);

    expect(preview).toBe(`\n${"a".repeat(479)}`);
  });
});
