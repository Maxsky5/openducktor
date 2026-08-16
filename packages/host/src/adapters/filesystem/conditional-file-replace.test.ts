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
  test("rejects a stale revision at the final best-effort validation", async () => {
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
        return snapshot("external change", "changed");
      },
      truncate: async () => {
        truncateCount += 1;
      },
      write: async () => undefined,
      sync: async () => undefined,
    });

    await expect(replacement).rejects.toMatchObject({ code: "stale_revision" });
    expect(snapshotCount).toBe(1);
    expect(truncateCount).toBe(0);
  });

  test("rejects a path move at the final best-effort validation", async () => {
    let verifyCount = 0;
    let truncateCount = 0;

    const replacement = conditionallyReplaceOpenFile({
      inputPath: "/repo/file.txt",
      expectedRevision: "original",
      bytes: encoder.encode("draft"),
      maxCurrentBytes: 1024,
      verifyEntry: async () => {
        verifyCount += 1;
        throw new FilesystemFileOperationError({
          code: "unavailable_file",
          operation: "replace",
          path: "/repo/file.txt",
          message: "The selected file moved.",
        });
      },
      snapshot: async () => snapshot("original", "original"),
      truncate: async () => {
        truncateCount += 1;
      },
      write: async () => undefined,
      sync: async () => undefined,
    });

    await expect(replacement).rejects.toMatchObject({ code: "unavailable_file" });
    expect(verifyCount).toBe(1);
    expect(truncateCount).toBe(0);
  });

  test("documents that a same-entry change after validation can be overwritten", async () => {
    let currentContents = "original";
    let externalChangeOccurred = false;
    let snapshotCount = 0;
    let truncateCount = 0;
    let verifyCount = 0;

    const replacement = await conditionallyReplaceOpenFile({
      inputPath: "/repo/file.txt",
      expectedRevision: "original",
      bytes: encoder.encode("draft"),
      maxCurrentBytes: 1024,
      verifyEntry: async () => {
        verifyCount += 1;
      },
      snapshot: async () => {
        snapshotCount += 1;
        return snapshot(currentContents, currentContents);
      },
      truncate: async () => {
        externalChangeOccurred = true;
        currentContents = "external change after final validation";
        truncateCount += 1;
        currentContents = "";
      },
      write: async (bytes) => {
        currentContents = new TextDecoder().decode(bytes);
      },
      sync: async () => undefined,
    });

    expect(externalChangeOccurred).toBe(true);
    expect(verifyCount).toBe(2);
    expect(snapshotCount).toBe(2);
    expect(truncateCount).toBe(1);
    expect(currentContents).toBe("draft");
    expect(new TextDecoder().decode(replacement.bytes)).toBe("draft");
  });

  test("reports a conflict when the post-write snapshot differs from the draft", async () => {
    let snapshotCount = 0;

    const replacement = conditionallyReplaceOpenFile({
      inputPath: "/repo/file.txt",
      expectedRevision: "original",
      bytes: encoder.encode("draft"),
      maxCurrentBytes: 1024,
      verifyEntry: async () => undefined,
      snapshot: async () => {
        snapshotCount += 1;
        if (snapshotCount === 1) return snapshot("original", "original");
        return snapshot("external change", "external");
      },
      truncate: async () => undefined,
      write: async () => undefined,
      sync: async () => undefined,
    });

    await expect(replacement).rejects.toMatchObject({ code: "stale_revision" });
    expect(snapshotCount).toBe(2);
  });

  test("rejects a path replacement after the draft is synced", async () => {
    let snapshotCount = 0;
    let verifyCount = 0;

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
            message: "The selected path changed while the file was opened.",
          });
        }
      },
      snapshot: async () => {
        snapshotCount += 1;
        return snapshot(snapshotCount === 1 ? "original" : "draft", "original");
      },
      truncate: async () => undefined,
      write: async () => undefined,
      sync: async () => undefined,
    });

    await expect(replacement).rejects.toMatchObject({ code: "unavailable_file" });
    expect(verifyCount).toBe(2);
  });
});
