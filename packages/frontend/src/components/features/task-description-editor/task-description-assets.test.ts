import { describe, expect, test } from "bun:test";
import {
  collectTaskDescriptionAssetIds,
  collectTaskDescriptionAssetsForSubmit,
} from "./task-description-assets";

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

  test("collects logical image references resolved through definitions", () => {
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const markdown = [
      "![Architecture][diagram]",
      "",
      `[diagram]: odt-asset:${assetId} "System diagram"`,
    ].join("\n");

    expect(Array.from(collectTaskDescriptionAssetIds(markdown))).toEqual([assetId]);
  });

  test("uses the first definition when an image reference identifier is duplicated", () => {
    const first = "550e8400-e29b-41d4-a716-446655440000";
    const second = "750e8400-e29b-41d4-a716-446655440001";
    const markdown = [
      "![Architecture][diagram]",
      "",
      `[diagram]: odt-asset:${first}`,
      `[diagram]: odt-asset:${second}`,
    ].join("\n");

    expect(Array.from(collectTaskDescriptionAssetIds(markdown))).toEqual([first]);
  });

  test("supplies a staged asset referenced through an image definition", () => {
    const referenced = "550e8400-e29b-41d4-a716-446655440000";
    const unreferenced = "750e8400-e29b-41d4-a716-446655440001";
    const markdown = `![Architecture][diagram]\n\n[diagram]: odt-asset:${referenced}`;

    const result = collectTaskDescriptionAssetsForSubmit(markdown, [referenced, unreferenced]);

    expect(Array.from(result.referencedAssetIds)).toEqual([referenced]);
    expect(result.stagedAssetIds).toEqual([referenced]);
  });
});
