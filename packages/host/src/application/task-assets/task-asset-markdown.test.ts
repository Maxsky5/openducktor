import { describe, expect, test } from "bun:test";
import { collectTaskDescriptionAssetIds } from "./task-asset-markdown";

const first = "550e8400-e29b-41d4-a716-446655440000";
const second = "550e8400-e29b-41d4-a716-446655440001";

describe("task description asset references", () => {
  test("collects distinct logical IDs from image destinations only", () => {
    const markdown = [
      `![one](odt-asset:${first})`,
      `![again](odt-asset:${first} "title")`,
      `![two](odt-asset:${second})`,
      `[not an image](odt-asset:${second})`,
      `plain odt-asset:${second}`,
      "```md",
      `![code](odt-asset:${second})`,
      "```",
      `\`![inline](odt-asset:${second})\``,
    ].join("\n\n");

    expect(collectTaskDescriptionAssetIds(markdown)).toEqual(new Set([first, second]));
  });

  test("collects logical IDs from referenced image definitions", () => {
    const markdown = [
      "![Architecture][diagram]",
      "",
      `[diagram]: odt-asset:${first} "Current architecture"`,
      "",
      `[ordinary link][diagram]`,
    ].join("\n");

    expect(collectTaskDescriptionAssetIds(markdown)).toEqual(new Set([first]));
  });

  test("rejects malformed logical image destinations", () => {
    expect(() => collectTaskDescriptionAssetIds("![bad](odt-asset:../foreign)")).toThrow(
      "invalid odt-asset image destination",
    );
  });

  test("enforces the distinct description asset limit", () => {
    const markdown = Array.from(
      { length: 51 },
      (_, index) =>
        `![${index}](odt-asset:550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")})`,
    ).join("\n");

    expect(() => collectTaskDescriptionAssetIds(markdown)).toThrow(
      "at most 50 distinct task assets",
    );
  });
});
