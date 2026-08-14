import { describe, expect, test } from "bun:test";
import {
  FilesystemFileOperationError,
  type FilesystemFileSnapshot,
} from "../../ports/filesystem-port";
import { conditionallyReplaceOpenFile } from "./conditional-file-replace";

const encoder = new TextEncoder();

const snapshot = (contents: string, revision: string): FilesystemFileSnapshot => ({
  bytes: encoder.encode(contents),
  isFile: true,
  size: contents.length,
  mtimeMs: 1,
  revision,
});

describe("conditionallyReplaceOpenFile", () => {
  test("rejects a revision change between validation and the first destructive write", async () => {
    let snapshotCount = 0;
    let truncateCount = 0;

    const replacement = conditionallyReplaceOpenFile({
      inputPath: "/repo/file.txt",
      expectedRevision: "original",
      bytes: encoder.encode("draft"),
      maxCurrentBytes: 1024,
      verifyEntry: async () => undefined,
      snapshot: async () => {
        snapshotCount += 1;
        return snapshotCount === 1
          ? snapshot("original", "original")
          : snapshot("external change", "changed");
      },
      truncate: async () => {
        truncateCount += 1;
      },
      write: async () => undefined,
      sync: async () => undefined,
    });

    await expect(replacement).rejects.toMatchObject({ code: "stale_revision" });
    expect(snapshotCount).toBe(2);
    expect(truncateCount).toBe(0);
  });

  test("rejects a path move between validation and the first destructive write", async () => {
    let verifyCount = 0;
    let truncateCount = 0;

    const replacement = conditionallyReplaceOpenFile({
      inputPath: "/repo/file.txt",
      expectedRevision: "original",
      bytes: encoder.encode("draft"),
      maxCurrentBytes: 1024,
      verifyEntry: async () => {
        verifyCount += 1;
        if (verifyCount === 2) {
          throw new FilesystemFileOperationError({
            code: "unavailable_file",
            operation: "replace",
            path: "/repo/file.txt",
            message: "The selected file moved.",
          });
        }
      },
      snapshot: async () => snapshot("original", "original"),
      truncate: async () => {
        truncateCount += 1;
      },
      write: async () => undefined,
      sync: async () => undefined,
    });

    await expect(replacement).rejects.toMatchObject({ code: "unavailable_file" });
    expect(verifyCount).toBe(2);
    expect(truncateCount).toBe(0);
  });
});
