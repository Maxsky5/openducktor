import { describe, expect, test } from "bun:test";
import {
  closeOpenStreamingCodeFence,
  findUnclosedCodeFence,
} from "./agent-chat-code-fence-healing";

describe("agent-chat-code-fence-healing", () => {
  test("leaves completed markdown unchanged", () => {
    expect(closeOpenStreamingCodeFence("```ts\nconst value = 1;\n```", true)).toBe(
      "```ts\nconst value = 1;\n```",
    );
  });

  test("temporarily closes an open backtick fence while streaming", () => {
    expect(closeOpenStreamingCodeFence("Before\n```ts\nconst value = 1;", true)).toBe(
      "Before\n```ts\nconst value = 1;\n```",
    );
  });

  test("uses the original fence width when healing longer fences", () => {
    expect(closeOpenStreamingCodeFence("````markdown\n```nested```", true)).toBe(
      "````markdown\n```nested```\n````",
    );
  });

  test("supports tilde fences and matching tilde closes", () => {
    expect(findUnclosedCodeFence("~~~sh\necho hi")).toEqual({
      marker: "~~~",
      char: "~",
      size: 3,
    });
    expect(findUnclosedCodeFence("~~~sh\necho hi\n~~~")).toBeNull();
  });

  test("matches very long closing fences without dynamic regex construction", () => {
    const marker = "`".repeat(10_000);

    expect(findUnclosedCodeFence(`${marker}markdown\ncontent\n${marker}`)).toBeNull();
  });

  test("rejects backtick fences when the info string contains backticks", () => {
    const markdown = "```markdown `literal`\nThis remains plain streaming text";

    expect(findUnclosedCodeFence(markdown)).toBeNull();
    expect(closeOpenStreamingCodeFence(markdown, true)).toBe(markdown);
  });

  test("does not heal non-streaming markdown", () => {
    expect(closeOpenStreamingCodeFence("```ts\nconst value = 1;", false)).toBe(
      "```ts\nconst value = 1;",
    );
  });

  test("preserves input whitespace when no streaming fence healing is needed", () => {
    expect(closeOpenStreamingCodeFence("  plain text  ", false)).toBe("  plain text  ");
    expect(closeOpenStreamingCodeFence("  plain text  ", true)).toBe("  plain text  ");
  });

  test("preserves surrounding whitespace when healing an open fence", () => {
    expect(closeOpenStreamingCodeFence("\n  ```ts\nconst value = 1;  ", true)).toBe(
      "\n  ```ts\nconst value = 1;  \n```",
    );
  });
});
