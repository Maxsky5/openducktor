import { describe, expect, test } from "bun:test";
import { buildTaskDescriptionPreviewMarkdown } from "./agent-chat-task-description-preview";

const PREVIEW_MAX_CHARACTERS = 480;

describe("buildTaskDescriptionPreviewMarkdown", () => {
  test("keeps a short description unchanged", () => {
    const description = "### Context\n\n- Failure: CI run\n- Test: workspace-session";
    expect(buildTaskDescriptionPreviewMarkdown(description)).toBe(description);
  });

  test("keeps body text when a short heading precedes a long paragraph", () => {
    const preview = buildTaskDescriptionPreviewMarkdown(`### Context\n${"b".repeat(1000)}`);

    expect(preview).toHaveLength(PREVIEW_MAX_CHARACTERS);
    expect(preview.startsWith("### Context\nbbb")).toBe(true);
  });

  test("bounds a long description and drops the distant tail", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `Line ${index + 1}`);
    const description = lines.join("\n");
    const preview = buildTaskDescriptionPreviewMarkdown(description);

    expect(preview).toBe(description.slice(0, PREVIEW_MAX_CHARACTERS));
    expect(preview.split("\n")[0]).toBe("Line 1");
    expect(preview).not.toContain("Line 200");
  });

  test("cuts a single long line at the character budget", () => {
    const preview = buildTaskDescriptionPreviewMarkdown("a".repeat(1000));

    expect(preview).toBe("a".repeat(PREVIEW_MAX_CHARACTERS));
  });
});
