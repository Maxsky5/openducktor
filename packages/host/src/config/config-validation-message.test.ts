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
});
