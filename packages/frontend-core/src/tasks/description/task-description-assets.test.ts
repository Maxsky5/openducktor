import { describe, expect, test } from "bun:test";
import {
  collectTaskDescriptionAssetIdsFromTree,
  selectSubmittedTaskDescriptionAssets,
  type TaskDescriptionMarkdownNode,
} from "./task-description-assets";

const first = "550e8400-e29b-41d4-a716-446655440000";
const second = "750e8400-e29b-41d4-a716-446655440001";

const paragraph = (...children: TaskDescriptionMarkdownNode[]): TaskDescriptionMarkdownNode => ({
  type: "paragraph",
  children,
});

describe("collectTaskDescriptionAssetIdsFromTree", () => {
  test("collects distinct image assets and ignores links and code", () => {
    const root: TaskDescriptionMarkdownNode = {
      type: "root",
      children: [
        paragraph({ type: "image", url: `odt-asset:${first}` }),
        paragraph({ type: "image", url: `odt-asset:${first}` }),
        paragraph({ type: "link", url: `odt-asset:${second}`, children: [] }),
        { type: "code" },
        paragraph({ type: "image", url: `odt-asset:${second}` }),
      ],
    };
    expect(Array.from(collectTaskDescriptionAssetIdsFromTree(root))).toEqual([first, second]);
  });

  test("ignores a forged asset ID", () => {
    const root = paragraph({
      type: "image",
      url: "odt-asset:550e8400e29b-41d4-a716-446655440000-",
    });
    expect(Array.from(collectTaskDescriptionAssetIdsFromTree(root))).toEqual([]);
  });

  test("resolves an image reference through the first definition", () => {
    const root: TaskDescriptionMarkdownNode = {
      type: "root",
      children: [
        paragraph({ type: "imageReference", identifier: "diagram" }),
        { type: "definition", identifier: "diagram", url: `odt-asset:${first}` },
        { type: "definition", identifier: "diagram", url: `odt-asset:${second}` },
      ],
    };
    expect(Array.from(collectTaskDescriptionAssetIdsFromTree(root))).toEqual([first]);
  });

  test("lists inline images before image references", () => {
    const root: TaskDescriptionMarkdownNode = {
      type: "root",
      children: [
        paragraph({ type: "imageReference", identifier: "diagram" }),
        paragraph({ type: "image", url: `odt-asset:${second}` }),
        { type: "definition", identifier: "diagram", url: `odt-asset:${first}` },
      ],
    };
    expect(Array.from(collectTaskDescriptionAssetIdsFromTree(root))).toEqual([second, first]);
  });
});

describe("selectSubmittedTaskDescriptionAssets", () => {
  test("sends only the staged assets that the description references", () => {
    expect(selectSubmittedTaskDescriptionAssets(new Set([first]), [first, second])).toEqual([
      first,
    ]);
  });
});
