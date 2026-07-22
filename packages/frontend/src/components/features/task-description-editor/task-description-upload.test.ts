import { describe, expect, mock, test } from "bun:test";
import { stageTaskDescriptionImage } from "./task-description-upload";

describe("task description image upload", () => {
  test("rejects disallowed browser media types before host staging", async () => {
    const taskAssetStage = mock(async () => {
      throw new Error("must not run");
    });
    const file = new File(["<svg/>"], "diagram.svg", { type: "image/svg+xml" });

    await expect(
      stageTaskDescriptionImage({ taskAssetStage }, "workspace-1", file),
    ).rejects.toThrow("PNG, JPEG, WebP, or GIF");
    expect(taskAssetStage).not.toHaveBeenCalled();
  });
});
