import { describe, expect, test } from "bun:test";
import { collectTaskDescriptionAssetIds } from "./task-description-assets";

describe("task description asset references", () => {
  test("collects distinct logical image references and ignores code and links", () => {
    const first = "550e8400-e29b-41d4-a716-446655440000";
    const second = "750e8400-e29b-41d4-a716-446655440001";
    const markdown = [
      `![one](odt-asset:${first})`,
      `![again](odt-asset:${first})`,
      `[link](odt-asset:${second})`,
      "```md",
      `![code](odt-asset:${second})`,
      "```",
      `![two](odt-asset:${second} "title")`,
    ].join("\n\n");

    expect(Array.from(collectTaskDescriptionAssetIds(markdown))).toEqual([first, second]);
  });

  test("ignores forged logical asset IDs that fail the shared UUID contract", () => {
    expect(
      Array.from(
        collectTaskDescriptionAssetIds("![forged](odt-asset:550e8400e29b-41d4-a716-446655440000-)"),
      ),
    ).toEqual([]);
  });
});
