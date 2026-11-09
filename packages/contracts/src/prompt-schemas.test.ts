// @ts-expect-error
import { describe, expect, test } from "bun:test";
import {
  agentPromptPlaceholderValues,
  extractPromptTemplatePlaceholders,
  parsePromptOverrideKey,
  promptOverrideKey,
  repoPromptOverridesSchema,
  validatePromptTemplatePlaceholders,
} from "./prompt-schemas";

describe("prompt placeholder validation", () => {
  test("extracts placeholders in appearance order without duplicates", () => {
    const template = [
      "Use {{task.id}} and {{task.title}}",
      "Repeat {{task.id}} and include {{ role.allowedTools }}",
    ].join("\n");

    expect(extractPromptTemplatePlaceholders(template)).toEqual([
      "task.id",
      "task.title",
      "role.allowedTools",
    ]);
  });

  test("reports unsupported placeholders", () => {
    const template = "Bad {{task.foo}} and {{unknown.value}} with {{task.id}}";
    const result = validatePromptTemplatePlaceholders(template, [], agentPromptPlaceholderValues);

    expect(result.placeholders).toEqual(["task.foo", "unknown.value", "task.id"]);
    expect(result.unsupportedPlaceholders).toEqual(["task.foo", "unknown.value"]);
    expect(result.missingRequiredPlaceholders).toEqual([]);
  });

  test("accepts templates that only use known placeholders", () => {
    const template = "Task {{task.id}} / {{task.description}} / {{humanFeedback}}";
    const result = validatePromptTemplatePlaceholders(template, [], agentPromptPlaceholderValues);

    expect(result.unsupportedPlaceholders).toEqual([]);
    expect(result.missingRequiredPlaceholders).toEqual([]);
  });

  test("reports the required placeholders that the template omits", () => {
    const result = validatePromptTemplatePlaceholders(
      "Review {{task.id}} before editing.",
      ["humanFeedback", "task.id"],
      agentPromptPlaceholderValues,
    );

    expect(result.unsupportedPlaceholders).toEqual([]);
    expect(result.missingRequiredPlaceholders).toEqual(["humanFeedback"]);
  });

  test("reports supported placeholders that the prompt cannot fill", () => {
    const result = validatePromptTemplatePlaceholders(
      "Rebase {{git.currentBranch}} for {{task.id}} with {{task.foo}}",
      [],
      ["task.id"],
    );

    expect(result.unsupportedPlaceholders).toEqual(["task.foo"]);
    expect(result.unfillablePlaceholders).toEqual(["git.currentBranch"]);
  });
});

describe("prompt override keys", () => {
  test("round-trips the owner and prompt ID of a key", () => {
    const role = { ownerKind: "role", ownerId: "build", promptId: "system" } as const;
    const workflow = {
      ownerKind: "workflow",
      ownerId: "rpi",
      promptId: "messages.qa_review",
    } as const;

    expect(parsePromptOverrideKey(promptOverrideKey(role))).toEqual(role);
    expect(parsePromptOverrideKey(promptOverrideKey(workflow))).toEqual(workflow);
  });

  test("rejects legacy template IDs and keys of another form", () => {
    for (const key of [
      "system.role.build.base",
      "messages.qa_review",
      '["task","rpi","messages.qa_review"]',
      '["role","build"]',
      '[ "role", "build", "system" ]',
    ]) {
      expect(parsePromptOverrideKey(key)).toBeNull();
      expect(
        repoPromptOverridesSchema.safeParse({ [key]: { template: "x", baseVersion: 1 } }).success,
      ).toBe(false);
    }
  });
});
