import { describe, expect, test } from "bun:test";
import { taskDescriptionImageError } from "@openducktor/frontend-core/tasks/operations/use-task-description-asset-operations";
import {
  collectDescriptionAssetIds,
  insertAtCursor,
  taskImageMarkdown,
} from "./description-assets";

const ASSET = "0b9f6a52-5c1e-4c2b-9d43-2a6b3f1d7e10";
const OTHER = "6f1e2d3c-4b5a-4968-8776-655443322110";

describe("description assets", () => {
  test("collects inline and reference task images with the shared rules", () => {
    const ids = collectDescriptionAssetIds(
      `Intro\n\n![shot](odt-asset:${ASSET})\n\n![ref][img]\n\n[img]: odt-asset:${OTHER}\n\n![web](https://example.com/a.png)`,
    );
    expect([...ids].sort()).toEqual([ASSET, OTHER].sort());
  });

  test("finds no task image in a description without an asset URI", () => {
    expect(
      collectDescriptionAssetIds("Intro\n\n![web](https://example.com/a.png)\n\n- a list"),
    ).toEqual(new Set());
  });

  test("writes the Markdown of a staged image without breaking the alt text", () => {
    expect(taskImageMarkdown("screen [1].png", ASSET)).toBe(`![screen 1.png](odt-asset:${ASSET})`);
  });

  test("inserts an image on its own lines at the cursor", () => {
    expect(insertAtCursor("Line one", 8, "![a](odt-asset:x)")).toEqual({
      text: "Line one\n\n![a](odt-asset:x)\n",
      cursor: 28,
    });
    expect(insertAtCursor("", 0, "![a](odt-asset:x)").text).toBe("![a](odt-asset:x)\n");
  });
});

describe("task image limits", () => {
  test("accepts host image types up to 10 MiB and explains other files", () => {
    expect(taskDescriptionImageError({ type: "image/png", size: 1024 })).toBeNull();
    expect(taskDescriptionImageError({ type: "image/jpeg", size: 10 * 1024 * 1024 })).toBeNull();
    expect(taskDescriptionImageError({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toBe(
      "Task description images must be 10 MiB or smaller.",
    );
    expect(taskDescriptionImageError({ type: "application/pdf", size: 10 })).toBe(
      "Task images must be PNG, JPEG, WebP, or GIF files.",
    );
  });
});
