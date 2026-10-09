import { describe, expect, test } from "bun:test";
import {
  buildReusablePromptValidationErrors,
  dropBlankLines,
  parseHookLines,
  prepareReusablePromptsForSave,
} from "./settings-read-model";

describe("settings-read-model", () => {
  test("parseHookLines preserves blank lines and raw spacing while editing", () => {
    expect(parseHookLines(" bun install \n\n npm test \n")).toEqual([
      " bun install ",
      "",
      " npm test ",
      "",
    ]);
  });

  test("dropBlankLines trims lines and removes blank rows", () => {
    expect(dropBlankLines([" npm test ", " ", ""])).toEqual(["npm test"]);
    expect(dropBlankLines([" "])).toEqual([]);
  });

  test("validates reusable prompt required fields, names, and duplicates", () => {
    expect(
      buildReusablePromptValidationErrors([
        { id: "missing", name: "", description: "", content: "" },
        { id: "invalid", name: "bad prompt", description: "", content: "content" },
        { id: "one", name: "Prompt.One", description: "", content: "content" },
        { id: "two", name: "prompt.one", description: "", content: "content" },
      ]),
    ).toEqual({
      missing: {
        name: "Prompt name is required.",
        content: "Prompt content is required.",
      },
      invalid: {
        name: "Use only letters, digits, dots, underscores, colons, or dashes.",
      },
      one: {
        name: "Prompt names must be unique.",
      },
      two: {
        name: "Prompt names must be unique.",
      },
    });
  });

  test("prepareReusablePromptsForSave trims persisted fields and rejects invalid prompts", () => {
    expect(
      prepareReusablePromptsForSave([
        {
          id: " prompt-1 ",
          name: " prompt.name ",
          description: " description ",
          content: " body ",
        },
      ]),
    ).toEqual([
      { id: "prompt-1", name: "prompt.name", description: "description", content: "body" },
    ]);

    expect(() =>
      prepareReusablePromptsForSave([
        { id: "prompt-1", name: "", description: "", content: "body" },
      ]),
    ).toThrow("Reusable prompts contain invalid fields.");
  });
});
