import { describe, expect, test } from "bun:test";
import type { WorkspaceFileTreeEntry } from "@openducktor/contracts";
import {
  fileContentView,
  HIGHLIGHT_LINE_LIMIT,
  lineNumberColumnChars,
  textLineCount,
} from "./file-content-model";
import { fileIcon, fileIconToken } from "./file-icons";
import {
  buildFileTreeIndex,
  directoryRows,
  FILE_GIT_STATUS_PRESENTATION,
  filesViewState,
  fileTreeIndex,
  formatFileSize,
  hasDirectory,
  searchFileRows,
} from "./file-tree-model";

const file = (
  path: string,
  gitStatus: WorkspaceFileTreeEntry["gitStatus"] = null,
): WorkspaceFileTreeEntry => ({ path, kind: "file", size: 10, mtimeMs: 1, gitStatus });
const directory = (path: string): WorkspaceFileTreeEntry => ({
  path,
  kind: "directory",
  size: null,
  mtimeMs: null,
  gitStatus: null,
});

const entries = [
  directory("src"),
  file("README.md"),
  file("src/zeta.ts"),
  file("src/Alpha.ts", "modified"),
  directory("src/lib"),
  file("src/lib/parse.ts", "added"),
  // The read omits the `docs` and `docs/guides` directories of this file.
  file("docs/guides/setup.md"),
];

const names = (rows: ReturnType<typeof directoryRows>) =>
  rows.map((row) => `${row.name}${row.kind === "directory" ? "/" : ""}`);

describe("file tree", () => {
  const index = buildFileTreeIndex(entries);

  test("lists a folder with directories first, then files by name", () => {
    expect(names(directoryRows(index, ""))).toEqual(["docs/guides/", "src/", "README.md"]);
    expect(names(directoryRows(index, "src"))).toEqual(["lib/", "Alpha.ts", "zeta.ts"]);
    expect(index.fileCount).toBe(5);
  });

  test("joins a folder that holds only one folder, and opens the inner folder", () => {
    expect(directoryRows(index, "").find((row) => row.name === "docs/guides")).toMatchObject({
      path: "docs/guides",
      kind: "directory",
      childCount: 1,
    });
    // A folder that holds a file stays one row.
    expect(directoryRows(index, "").find((row) => row.path === "src")?.name).toBe("src");
  });

  test("adds the directories that the read omits", () => {
    expect(names(directoryRows(index, "docs"))).toEqual(["guides/"]);
    expect(names(directoryRows(index, "docs/guides"))).toEqual(["setup.md"]);
    expect(hasDirectory(index, "docs/guides")).toBe(true);
    expect(hasDirectory(index, "")).toBe(true);
    expect(hasDirectory(index, "README.md")).toBe(false);
    expect(hasDirectory(index, "gone")).toBe(false);
  });

  test("keeps the Git status of each entry and marks the folders that hold changes", () => {
    const src = directoryRows(index, "src");
    expect(src.find((row) => row.path === "src/Alpha.ts")?.gitStatus).toBe("modified");
    expect(src.find((row) => row.path === "src/lib")).toMatchObject({
      changed: true,
      childCount: 1,
    });
    expect(directoryRows(index, "").find((row) => row.path === "docs/guides")?.changed).toBe(false);
  });

  test("search finds files under the folder in any letter case, with their folders", () => {
    expect(searchFileRows(index, "PARSE", "").map((row) => [row.path, row.directory])).toEqual([
      ["src/lib/parse.ts", "src/lib"],
    ]);
    expect(searchFileRows(index, "ts", "src/lib").map((row) => row.path)).toEqual([
      "src/lib/parse.ts",
    ]);
    expect(searchFileRows(index, "guides/", "src")).toEqual([]);
    // Results come by path in any letter case.
    expect(searchFileRows(index, "a", "").map((row) => row.path)).toEqual([
      "README.md",
      "src/Alpha.ts",
      "src/lib/parse.ts",
      "src/zeta.ts",
    ]);
    expect(searchFileRows(index, "missing", "")).toEqual([]);
    expect(searchFileRows(index, "  ", "")).toEqual([]);
  });

  test("builds the tree once for each read", () => {
    expect(fileTreeIndex(entries)).toBe(fileTreeIndex(entries));
  });

  test("shows a status letter for each Git change except an ignored entry", () => {
    expect(FILE_GIT_STATUS_PRESENTATION.modified.letter).toBe("M");
    expect(FILE_GIT_STATUS_PRESENTATION.untracked.letter).toBe("U");
    expect(FILE_GIT_STATUS_PRESENTATION.ignored).toEqual({ letter: null, label: "Ignored" });
  });

  test("names the size of a file", () => {
    expect(formatFileSize(1)).toBe("1 byte");
    expect(formatFileSize(512)).toBe("512 bytes");
    expect(formatFileSize(4300)).toBe("4.2 KB");
    expect(formatFileSize(18 * 1024 * 1024)).toBe("18 MB");
  });
});

describe("file content", () => {
  const base = { rootPath: "/repo", relativePath: "src/a.ts", size: 4, mtimeMs: 1 };

  test("shows text, and an empty file as a message", () => {
    expect(fileContentView({ ...base, kind: "text", contents: "a\nb", revision: "r1" })).toEqual({
      kind: "text",
      contents: "a\nb",
    });
    expect(fileContentView({ ...base, kind: "text", contents: "", revision: "r1" })).toMatchObject({
      kind: "message",
      title: "Empty File",
    });
  });

  test("shows the host reason for a binary file or a file over the read limit", () => {
    expect(
      fileContentView({
        ...base,
        kind: "unsupported",
        reason: "binary",
        message: "The file is binary.",
      }),
    ).toEqual({ kind: "message", title: "Binary File", message: "The file is binary." });
    expect(
      fileContentView({
        ...base,
        kind: "unsupported",
        reason: "too_large",
        message: "The file is over the 2 MiB read limit.",
      }),
    ).toEqual({
      kind: "message",
      title: "File Too Large",
      message: "The file is over the 2 MiB read limit.",
    });
  });

  test("shows an image read as an image", () => {
    expect(
      fileContentView({
        ...base,
        kind: "image",
        mime: "image/png",
        base64: "AAAA",
        revision: "r1",
      }),
    ).toEqual({ kind: "image", uri: "data:image/png;base64,AAAA", mime: "image/png" });
  });

  test("sizes the line number column for the largest number, as desktop", () => {
    expect(lineNumberColumnChars(9)).toBe(2.25);
    expect(lineNumberColumnChars(10_000)).toBe(6.25);
    expect(lineNumberColumnChars(0)).toBe(2.25);
  });

  test("counts lines as the code view splits them", () => {
    expect(textLineCount("a")).toBe(1);
    expect(textLineCount("a\nb")).toBe(2);
    expect(textLineCount("a\nb\n")).toBe(2);
    expect(textLineCount("a\r\nb\rc")).toBe(3);
    expect(textLineCount("\n")).toBe(1);
    expect(textLineCount("x\n".repeat(HIGHLIGHT_LINE_LIMIT + 1))).toBe(HIGHLIGHT_LINE_LIMIT + 1);
  });
});

describe("file icons", () => {
  test("finds the kind of a file as the desktop tree: the name, then the longest extension", () => {
    expect(fileIconToken("parse.ts")).toBe("typescript");
    expect(fileIconToken("view.tsx")).toBe("react");
    expect(fileIconToken("parse.test.ts")).toBe("typescript");
    expect(fileIconToken("README.md")).toBe("markdown");
    expect(fileIconToken("CLAUDE.md")).toBe("claude");
    expect(fileIconToken(".gitignore")).toBe("git");
    expect(fileIconToken("Dockerfile")).toBe("docker");
    expect(fileIconToken("logo.PNG")).toBe("image");
    expect(fileIconToken("Makefile")).toBe("default");
    expect(fileIconToken(".env")).toBe("text");
  });

  test("draws each kind with an icon and the desktop color", () => {
    expect(fileIcon("parse.ts")).toEqual({ icon: "file-code", color: "blue" });
    expect(fileIcon("package.json")).toEqual({ icon: "file-json", color: "orange" });
    expect(fileIcon("Makefile")).toEqual({ icon: "file", color: "gray" });
  });
});

describe("filesViewState", () => {
  const ready = {
    directoryPending: false,
    unavailableReason: null,
    rootPath: "/repo",
    loaded: true,
    error: null,
    folderFound: true,
  };

  test("shows the folder of a loaded tree, also after a failed refresh", () => {
    expect(filesViewState(ready)).toEqual({ kind: "ready", rootPath: "/repo" });
    expect(filesViewState({ ...ready, error: new Error("offline") })).toEqual({
      kind: "ready",
      rootPath: "/repo",
    });
  });

  test("loads while the directory resolves or the first read runs", () => {
    expect(filesViewState({ ...ready, directoryPending: true })).toEqual({ kind: "loading" });
    expect(filesViewState({ ...ready, loaded: false })).toEqual({ kind: "loading" });
  });

  test("says why the files are unavailable", () => {
    expect(filesViewState({ ...ready, unavailableReason: "No worktree yet." })).toEqual({
      kind: "unavailable",
      reason: "No worktree yet.",
    });
    expect(filesViewState({ ...ready, rootPath: null })).toEqual({
      kind: "unavailable",
      reason: "The working directory is unavailable.",
    });
  });

  test("reports a first read that failed and a folder that is gone", () => {
    const error = new Error("offline");
    expect(filesViewState({ ...ready, loaded: false, error })).toEqual({ kind: "failed", error });
    expect(filesViewState({ ...ready, folderFound: false })).toEqual({ kind: "missing_folder" });
  });
});
