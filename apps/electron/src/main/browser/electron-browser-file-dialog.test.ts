import { describe, expect, test } from "bun:test";
import { fileDialogFilters } from "./electron-browser-file-dialog";

describe("fileDialogFilters", () => {
  test("shows all files when the input accepts any file", () => {
    expect(fileDialogFilters([])).toEqual([]);
    expect(fileDialogFilters(["application/x-unknown-type"])).toEqual([]);
  });

  test("combines extensions, MIME types, and MIME groups", () => {
    const [filter] = fileDialogFilters([".CSV", "application/pdf", "image/*"]);
    expect(filter?.name).toBe("Accepted files");
    expect(filter?.extensions).toContain("csv");
    expect(filter?.extensions).toContain("pdf");
    expect(filter?.extensions).toContain("png");
    expect(filter?.extensions).toContain("jpeg");
    expect(filter?.extensions).not.toContain("mp4");
  });
});
