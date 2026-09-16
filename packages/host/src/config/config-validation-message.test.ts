import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { configValidationMessage, type PayloadValue } from "./config-validation-message";

const schema = z.object({
  theme: z.enum(["light", "dark"]),
  tags: z.array(z.string()).min(1),
});

const messagesFor = (payload: PayloadValue): string[] => {
  const result = schema.safeParse(payload);
  if (result.success) {
    throw new Error("Expected validation failure");
  }

  return configValidationMessage(result.error, payload).split("\n");
};

const issueLines = (rejected: Record<string, number>): string[] => {
  const record = z.record(z.string(), z.string());
  const result = record.safeParse(rejected);
  if (result.success) {
    throw new Error("Expected validation failure");
  }

  return configValidationMessage(result.error, rejected).split("\n");
};

describe("config validation message", () => {
  test("names the container type of a rejected value", () => {
    expect(messagesFor({ theme: [], tags: ["a"] })).toEqual([
      'theme: Invalid option: expected one of "light"|"dark" (found array)',
    ]);
    expect(messagesFor({ theme: {}, tags: ["a"] })).toEqual([
      'theme: Invalid option: expected one of "light"|"dark" (found object)',
    ]);
  });

  test("shows the rejected scalar value and marks a missing field", () => {
    expect(messagesFor({ theme: "blue", tags: ["a"] })).toEqual([
      'theme: Invalid option: expected one of "light"|"dark" (found "blue")',
    ]);
    expect(messagesFor({ tags: ["a"] })).toEqual([
      'theme: Invalid option: expected one of "light"|"dark" (missing)',
    ]);
  });

  test("formats issues without a payload", () => {
    const result = schema.safeParse({ theme: [], tags: ["a"] });
    if (result.success) {
      throw new Error("Expected validation failure");
    }

    expect(configValidationMessage(result.error)).toBe(
      'theme: Invalid option: expected one of "light"|"dark"',
    );
  });

  test("passes through failures that are not validation issues", () => {
    expect(configValidationMessage(new Error("Config file is unreadable"))).toBe(
      "Config file is unreadable",
    );
    expect(configValidationMessage("plain failure")).toBe("plain failure");
  });

  test("caps the reported issues and counts the rest", () => {
    const lines = issueLines({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 });

    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("one: Invalid input: expected string, received number (found 1)");
    expect(lines.at(-1)).toBe("2 more problems not shown.");
  });

  test("uses the singular form for one remaining issue", () => {
    const lines = issueLines({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 });

    expect(lines.at(-1)).toBe("1 more problem not shown.");
  });

  test("reports the rule for an invalid record key", () => {
    const keyed = z.record(z.string().regex(/^[a-z]+$/, "Lowercase only."), z.number());
    const result = keyed.safeParse({ BAD: 1 });
    if (result.success) {
      throw new Error("Expected validation failure");
    }

    expect(configValidationMessage(result.error, { BAD: 1 })).toBe(
      "BAD: Lowercase only. (invalid key)",
    );
  });

  test("collapses newlines in a rejected field reason", () => {
    const multiline = z.string().refine(() => false, "First line.\nSecond line.");
    const result = multiline.safeParse("x");
    if (result.success) {
      throw new Error("Expected validation failure");
    }

    expect(configValidationMessage(result.error, "x")).toBe(
      'config: First line. Second line. (found "x")',
    );
  });
});
