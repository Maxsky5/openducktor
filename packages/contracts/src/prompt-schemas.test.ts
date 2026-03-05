// @ts-expect-error
import { describe, expect, test } from "bun:test";
import {
  extractPromptTemplatePlaceholders,
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
    const result = validatePromptTemplatePlaceholders(template);

    expect(result.placeholders).toEqual(["task.foo", "unknown.value", "task.id"]);
    expect(result.unsupportedPlaceholders).toEqual(["task.foo", "unknown.value"]);
  });

  test("accepts templates that only use known placeholders", () => {
    const template = "Task {{task.id}} / {{task.description}}";
    const result = validatePromptTemplatePlaceholders(template);

    expect(result.unsupportedPlaceholders).toEqual([]);
  });
});
